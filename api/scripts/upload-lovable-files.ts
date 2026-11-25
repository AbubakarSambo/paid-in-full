/**
 * Uploads the files exported from Lovable's Supabase Storage to Cloudinary and points the imported rows at them.
 * Run AFTER scripts/import-lovable.ts. Safe to re-run: rows that already carry a Cloudinary file are skipped and
 * public ids are deterministic (the row id), so a repeated upload overwrites instead of duplicating.
 *
 *   DATABASE_URL=<target> npx ts-node --transpile-only scripts/upload-lovable-files.ts --dir ~/Downloads/Paid_in_Full_Auth_and_Storage_2026-11-24 --dry-run
 *   CLOUDINARY_URL=cloudinary://key:secret@cloud DATABASE_URL=<target> npx ts-node --transpile-only scripts/upload-lovable-files.ts --dir <export dir>
 *
 * What it does (same conventions as QueueAttachmentsService, so the app can serve/delete the files):
 *   queue-attachments bucket -> queue_item_attachments.file_url / storage_path = "cloudinary:<public_id>"
 *                               (PDFs as resource_type raw, images as image; folder paid-in-full/<workspace>/attachments)
 *   workspace-assets bucket  -> workspaces.logo_url / signature_url (they still point at Lovable's public bucket)
 *   user-avatars bucket      -> users.avatar_url when the user has none
 * --dry-run needs no Cloudinary credentials: it only checks the plan (files on disk, sizes, rows without a file).
 */
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d?: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const DRY = flag('--dry-run');
const DIR = (opt('--dir') ?? '').replace(/^~/, os.homedir());
const CONCURRENCY = Number(opt('--concurrency', '4'));
const REPORT = opt('--report', 'upload-report.json')!;
const MAX_BYTES = 10 * 1024 * 1024; // Cloudinary free-plan per-file limit; the app enforces the same 10 MB

if (!DIR || !fs.existsSync(path.join(DIR, 'storage_manifest.csv'))) throw new Error('--dir must point at the export folder containing storage_manifest.csv and storage/');
if (!DRY) {
  const { CLOUDINARY_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
  } else if (!CLOUDINARY_URL) {
    throw new Error('Set CLOUDINARY_URL (or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET), or pass --dry-run.');
  }
}

const prisma = new PrismaClient();

// ── manifest ──────────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

interface Obj { bucket: string; name: string; size: number; mime: string; file: string }
const [header, ...lines] = parseCsv(fs.readFileSync(path.join(DIR, 'storage_manifest.csv'), 'utf8'));
const col = (n: string) => header.indexOf(n);
const objects = new Map<string, Obj>(); // "bucket/name" -> object
for (const l of lines) {
  const o: Obj = { bucket: l[col('bucket_id')], name: l[col('name')], size: Number(l[col('size')]), mime: l[col('mimetype')], file: path.join(DIR, 'storage', l[col('bucket_id')], l[col('name')]) };
  objects.set(`${o.bucket}/${o.name}`, o);
}

// ── upload helper ─────────────────────────────────────────────────────────────

const report: Record<string, any> = { mode: DRY ? 'dry-run' : 'upload', attachments: {}, assets: {}, problems: [] as any[] };
const problem = (kind: string, id: string, detail: string) => report.problems.push({ kind, id, detail });

async function upload(o: Obj, opts: { folder: string; publicId: string; resourceType: 'raw' | 'image' }) {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await cloudinary.uploader.upload(o.file, {
        folder: opts.folder, public_id: opts.publicId, resource_type: opts.resourceType, overwrite: true, unique_filename: false, use_filename: false,
      });
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw last;
}

async function pool<T>(items: T[], worker: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) { const i = next++; await worker(items[i], i); }
  }));
}

// ── 1. queue attachments ─────────────────────────────────────────────────────

async function attachments() {
  const rows = await prisma.$queryRawUnsafe<{ id: string; workspace_id: string; storage_path: string; file_url: string | null; mime_type: string | null }[]>(
    `select id, workspace_id, storage_path, file_url, mime_type from queue_item_attachments`,
  );
  const todo = rows.filter((r) => !r.file_url && !r.storage_path.startsWith('cloudinary:') && !r.storage_path.startsWith('local:'));
  const stat = { rows: rows.length, alreadyDone: rows.length - todo.length, planned: 0, uploaded: 0, bytes: 0, noFileInExport: 0, missingOnDisk: 0, sizeMismatch: 0, tooLarge: 0, failed: 0 };
  const plan: { row: (typeof rows)[number]; obj: Obj; raw: boolean }[] = [];
  for (const r of todo) {
    const obj = objects.get(`queue-attachments/${r.storage_path}`);
    if (!obj) { stat.noFileInExport++; problem('attachment-not-in-export', r.id, r.storage_path); continue; }
    if (!fs.existsSync(obj.file)) { stat.missingOnDisk++; problem('attachment-missing-on-disk', r.id, obj.file); continue; }
    const real = fs.statSync(obj.file).size;
    if (real !== obj.size) { stat.sizeMismatch++; problem('attachment-size-mismatch', r.id, `manifest ${obj.size} vs disk ${real}`); continue; }
    if (real > MAX_BYTES) { stat.tooLarge++; problem('attachment-too-large', r.id, `${real} bytes`); continue; }
    plan.push({ row: r, obj, raw: obj.mime === 'application/pdf' });
    stat.bytes += real;
  }
  stat.planned = plan.length;
  report.attachments = stat;
  console.log(`attachments: ${plan.length} to upload (${(stat.bytes / 1048576).toFixed(0)} MB), ${stat.alreadyDone} already done, ${stat.noFileInExport + stat.missingOnDisk + stat.sizeMismatch + stat.tooLarge} cannot be uploaded`);
  if (DRY) return;
  await pool(plan, async ({ row, obj, raw }, i) => {
    try {
      const res = await upload(obj, { folder: `paid-in-full/${row.workspace_id}/attachments`, publicId: raw ? `${row.id}.pdf` : row.id, resourceType: raw ? 'raw' : 'image' });
      await prisma.$executeRawUnsafe(`update queue_item_attachments set file_url=$1, storage_path=$2 where id=$3`, res.secure_url, `cloudinary:${res.public_id}`, row.id);
      stat.uploaded++;
      if (stat.uploaded % 50 === 0) console.log(`  ${stat.uploaded}/${plan.length}`);
    } catch (e) {
      stat.failed++;
      problem('attachment-upload-failed', row.id, String((e as Error)?.message ?? e));
    }
  });
}

// ── 2. workspace branding + avatars ──────────────────────────────────────────

const bucketObject = (url: string | null, bucket: string): string | null => {
  const m = url?.match(new RegExp(`/storage/v1/object/public/${bucket}/(.+)$`));
  return m ? decodeURIComponent(m[1]) : null;
};

async function branding() {
  const stat = { planned: 0, uploaded: 0, notAnImage: 0, noFile: 0, failed: 0 };
  const ws = await prisma.$queryRawUnsafe<{ id: string; logo_url: string | null; signature_url: string | null }[]>(`select id, logo_url, signature_url from workspaces`);
  const jobs: { id: string; column: 'logo_url' | 'signature_url'; obj: Obj }[] = [];
  for (const w of ws) {
    for (const column of ['logo_url', 'signature_url'] as const) {
      const name = bucketObject(w[column], 'workspace-assets');
      if (!name) continue; // empty, already migrated, or an external URL
      const obj = objects.get(`workspace-assets/${name}`);
      if (!obj || !fs.existsSync(obj.file)) { stat.noFile++; problem('asset-missing', w.id, `${column}: ${name}`); continue; }
      if (!obj.mime.startsWith('image/')) { stat.notAnImage++; problem('asset-not-an-image', w.id, `${column}: ${name} (${obj.mime}); left pointing at the old URL`); continue; }
      jobs.push({ id: w.id, column, obj });
    }
  }
  stat.planned = jobs.length;

  const users = await prisma.$queryRawUnsafe<{ id: string; avatar_url: string | null }[]>(`select id, avatar_url from users`);
  const avatarJobs = [...objects.values()].filter((o) => o.bucket === 'user-avatars' && users.some((u) => u.id === o.name.split('/')[0] && !u.avatar_url));
  report.assets = { ...stat, avatars: avatarJobs.length };
  console.log(`branding: ${jobs.length} workspace images, ${avatarJobs.length} avatar(s) (${stat.notAnImage} non-image, ${stat.noFile} missing)`);
  if (DRY) return;

  for (const j of jobs) {
    try {
      const res = await upload(j.obj, { folder: `paid-in-full/${j.id}/branding`, publicId: j.column === 'logo_url' ? 'logo' : 'signature', resourceType: 'image' });
      await prisma.$executeRawUnsafe(`update workspaces set ${j.column}=$1 where id=$2`, res.secure_url, j.id);
      stat.uploaded++;
    } catch (e) { stat.failed++; problem('asset-upload-failed', j.id, String((e as Error)?.message ?? e)); }
  }
  for (const o of avatarJobs) {
    const userId = o.name.split('/')[0];
    try {
      const res = await upload(o, { folder: `paid-in-full/avatars`, publicId: userId, resourceType: 'image' });
      await prisma.$executeRawUnsafe(`update users set avatar_url=$1 where id=$2`, res.secure_url, userId);
      stat.uploaded++;
    } catch (e) { stat.failed++; problem('avatar-upload-failed', userId, String((e as Error)?.message ?? e)); }
  }
  report.assets = { ...stat, avatars: avatarJobs.length };
}

(async () => {
  console.log(`Lovable file upload — ${DRY ? 'DRY RUN (no network, no writes)' : 'UPLOADING'}; ${objects.size} objects in the manifest`);
  await attachments();
  await branding();
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`Report: ${REPORT}; ${report.problems.length} problem(s)`);
  if (report.attachments.failed || report.assets.failed) process.exitCode = 1;
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
