// Local-disk storage adapter for images. Validates the real file type from bytes, strips metadata
// (EXIF/GPS), resizes, and writes WebP + thumbnail. Swap for S3/R2 by implementing the same interface.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { randomToken } from '../lib/security.js';
import { HttpError } from '../lib/http.js';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif']);

export async function storeImage(buffer, { folder = 'listings', maxSize = 1600, thumbSize = 480 } = {}) {
  if (!buffer?.length) throw new HttpError(400, 'Empty file.');
  if (buffer.length > MAX_BYTES) throw new HttpError(413, 'Images must be 8 MB or smaller.');
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new HttpError(400, 'That file is not a supported image.');
  }
  if (!ALLOWED.has(meta.format)) throw new HttpError(400, 'Use JPG, PNG, WebP, AVIF or GIF images.');
  const dir = path.join(config.uploadDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now().toString(36)}-${randomToken(9)}`;
  const main = sharp(buffer).rotate().resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 });
  const info = await main.toFile(path.join(dir, `${name}.webp`));
  await sharp(buffer).rotate().resize({ width: thumbSize, height: thumbSize, fit: 'cover' }).webp({ quality: 74 }).toFile(path.join(dir, `${name}-t.webp`));
  return {
    url: `/uploads/${folder}/${name}.webp`,
    thumbUrl: `/uploads/${folder}/${name}-t.webp`,
    width: info.width,
    height: info.height,
  };
}

export function removeStored(url) {
  if (!url?.startsWith('/uploads/')) return;
  const p = path.join(config.uploadDir, url.replace('/uploads/', ''));
  if (p.startsWith(config.uploadDir)) fs.rm(p, { force: true }, () => {});
}

/** Decode a data: URL (client-side compressed upload) into a Buffer. */
export function decodeDataUrl(s) {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(String(s || ''));
  if (!m) throw new HttpError(400, 'Invalid image data.');
  return Buffer.from(m[1], 'base64');
}
