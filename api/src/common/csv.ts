/**
 * Small dependency-free CSV helpers (RFC 4180-ish: quoted fields, "" escapes, CRLF/LF).
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = (text ?? '').replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cur.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
      if (c === '\r' && src[i + 1] === '\n') i++;
    } else {
      field += c;
    }
  }
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((v) => (v ?? '').trim() !== ''));
}

/** Normalise a header cell: "Account No." → "accountno". */
export function normalizeCsvHeader(h: string): string {
  return (h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Parse CSV with a header row into records keyed by canonical field names.
 * `aliases` maps canonical field → accepted (normalised) header spellings.
 */
export function parseCsvRecords<K extends string>(
  text: string,
  aliases: Record<K, string[]>,
): { records: Array<Partial<Record<K, string>> & { _row: number }>; unknownHeaders: string[] } {
  const rows = parseCsvRows(text);
  if (!rows.length) return { records: [], unknownHeaders: [] };
  const header = rows[0].map(normalizeCsvHeader);
  const colFor: Partial<Record<K, number>> = {};
  const unknownHeaders: string[] = [];
  header.forEach((h, idx) => {
    const key = (Object.keys(aliases) as K[]).find((k) => normalizeCsvHeader(k) === h || aliases[k].includes(h));
    if (key && colFor[key] === undefined) colFor[key] = idx;
    else if (!key) unknownHeaders.push(rows[0][idx]);
  });
  const records = rows.slice(1).map((r, i) => {
    const rec = { _row: i + 2 } as Partial<Record<K, string>> & { _row: number };
    (Object.keys(colFor) as K[]).forEach((k) => {
      const v = r[colFor[k] as number];
      if (v !== undefined && v.trim() !== '') (rec as Record<string, unknown>)[k] = v.trim();
    });
    return rec;
  });
  return { records, unknownHeaders };
}

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

export function parseCsvBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return /^(1|y|yes|true|active|on)$/i.test(v.trim());
}
