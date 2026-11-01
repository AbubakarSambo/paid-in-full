import { BadRequestException, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

const logger = new Logger('ImageUpload');
const ALLOWED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml'];

export interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

function cloudinaryConfigured(): boolean {
  // The SDK auto-reads CLOUDINARY_URL; explicit triplet also supported.
  if (process.env.CLOUDINARY_URL) return true;
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    return true;
  }
  return false;
}

/**
 * Validates an image (type + max size) and returns a URL to store: a Cloudinary secure_url when
 * Cloudinary is configured, otherwise a base64 data: URL (fine for avatars/logos at ≤2 MB).
 */
export async function storeImage(file: UploadedImageFile | undefined, opts: { maxBytes: number; folder: string; label: string }) {
  if (!file?.buffer?.length) throw new BadRequestException(`Choose an image to upload for the ${opts.label}.`);
  if (!ALLOWED.includes(file.mimetype)) {
    throw new BadRequestException('Use a PNG, JPG, WebP, GIF or SVG image.');
  }
  if (file.size > opts.maxBytes) {
    const mb = Math.round((opts.maxBytes / (1024 * 1024)) * 10) / 10;
    throw new BadRequestException(`The ${opts.label} must be ${mb} MB or smaller.`);
  }
  const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  if (!cloudinaryConfigured()) return dataUrl;
  try {
    const res = await cloudinary.uploader.upload(dataUrl, { folder: `paid-in-full/${opts.folder}`, resource_type: 'image' });
    return res.secure_url;
  } catch (error) {
    logger.error('Cloudinary upload failed; falling back to data URL', error as Error);
    return dataUrl;
  }
}
