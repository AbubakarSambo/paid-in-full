import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/** The subset of Express.Multer.File we use (no @types/multer in this repo). */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = /^(application\/pdf|image\/(png|jpe?g|gif|webp|heic|heif))$/i;

/** Multer options for @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD_OPTIONS)). */
export const ATTACHMENT_UPLOAD_OPTIONS = { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } };

/**
 * Attachments for queue items and requisitions, linked through attachmentGroupId (spec §4
 * queue_item_attachments: 10 MB each, PDF/images). Stored on Cloudinary when configured
 * (CLOUDINARY_URL, or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET),
 * otherwise on local disk under api/uploads (dev only: serverless disks are ephemeral).
 */
@Injectable()
export class QueueAttachmentsService {
  private readonly logger = new Logger(QueueAttachmentsService.name);
  private readonly cloudinaryEnabled: boolean;
  private readonly uploadRoot = path.resolve(process.cwd(), 'uploads');

  constructor(private readonly prisma: PrismaService) {
    const { CLOUDINARY_URL, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
      cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
        secure: true,
      });
      this.cloudinaryEnabled = true;
    } else {
      // The SDK reads CLOUDINARY_URL from the environment by itself.
      this.cloudinaryEnabled = !!CLOUDINARY_URL;
    }
  }

  validate(file: UploadedFileLike | undefined): asserts file is UploadedFileLike {
    if (!file || !file.buffer) throw new BadRequestException('A file is required (multipart field "file")');
    if (file.size > MAX_ATTACHMENT_BYTES) throw new BadRequestException('File is larger than 10 MB');
    if (!ALLOWED_MIME.test(file.mimetype)) throw new BadRequestException('Only PDF and image files are allowed');
  }

  private safeName(name: string): string {
    return (name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  }

  private async storeCloudinary(workspaceId: string, file: UploadedFileLike): Promise<{ storagePath: string; fileUrl: string }> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `paid-in-full/${workspaceId}/attachments`,
          resource_type: file.mimetype === 'application/pdf' ? 'raw' : 'image',
          use_filename: true,
          unique_filename: true,
        },
        (err, res) => (err || !res ? reject(err ?? new Error('Upload failed')) : resolve(res)),
      );
      stream.end(file.buffer);
    });
    return { storagePath: `cloudinary:${result.public_id}`, fileUrl: result.secure_url };
  }

  private async storeLocal(workspaceId: string, file: UploadedFileLike): Promise<{ storagePath: string; fileUrl: null }> {
    const dir = path.join(this.uploadRoot, workspaceId);
    await fs.promises.mkdir(dir, { recursive: true });
    const rel = path.join(workspaceId, `${randomUUID()}-${this.safeName(file.originalname)}`);
    await fs.promises.writeFile(path.join(this.uploadRoot, rel), file.buffer);
    return { storagePath: `local:${rel}`, fileUrl: null };
  }

  /** Stores the file and records it against the attachment group (and queue item, if any). */
  async upload(
    workspaceId: string,
    userId: string,
    file: UploadedFileLike | undefined,
    opts: { attachmentGroupId: string; queueItemId?: string | null },
  ) {
    this.validate(file);
    let stored: { storagePath: string; fileUrl: string | null };
    if (this.cloudinaryEnabled) {
      try {
        stored = await this.storeCloudinary(workspaceId, file);
      } catch (error) {
        this.logger.error('Cloudinary upload failed; falling back to local disk', error as Error);
        stored = await this.storeLocal(workspaceId, file);
      }
    } else {
      stored = await this.storeLocal(workspaceId, file);
    }
    return this.prisma.queueItemAttachment.create({
      data: {
        workspaceId,
        attachmentGroupId: opts.attachmentGroupId,
        queueItemId: opts.queueItemId ?? null,
        storagePath: stored.storagePath,
        fileUrl: stored.fileUrl,
        fileName: file.originalname || 'file',
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById: userId,
      },
    });
  }

  listByGroup(workspaceId: string, attachmentGroupId: string | null | undefined) {
    if (!attachmentGroupId) return Promise.resolve([]);
    return this.prisma.queueItemAttachment.findMany({
      where: { workspaceId, attachmentGroupId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async remove(workspaceId: string, attachmentId: string) {
    const att = await this.prisma.queueItemAttachment.findFirst({ where: { id: attachmentId, workspaceId } });
    if (!att) throw new NotFoundException('Attachment not found');
    await this.prisma.queueItemAttachment.delete({ where: { id: att.id } });
    if (att.storagePath.startsWith('local:')) {
      await fs.promises.unlink(path.join(this.uploadRoot, att.storagePath.slice(6))).catch(() => undefined);
    }
    return { success: true };
  }

  /** Streams a local file or redirects to the Cloudinary URL. Scoped to the caller's workspace. */
  async download(workspaceId: string, attachmentId: string, res: Response): Promise<void> {
    const att = await this.prisma.queueItemAttachment.findFirst({ where: { id: attachmentId, workspaceId } });
    if (!att) throw new NotFoundException('Attachment not found');
    if (att.storagePath.startsWith('local:')) {
      const full = path.resolve(this.uploadRoot, att.storagePath.slice(6));
      if (!full.startsWith(this.uploadRoot) || !fs.existsSync(full)) throw new NotFoundException('File missing from storage');
      res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${this.safeName(att.fileName)}"`);
      fs.createReadStream(full).pipe(res);
      return;
    }
    const url = att.fileUrl || att.storagePath;
    if (!/^https?:\/\//.test(url)) throw new NotFoundException('File missing from storage');
    res.redirect(url);
  }
}
