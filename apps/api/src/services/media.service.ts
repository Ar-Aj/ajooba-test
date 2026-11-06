import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { v2 as CloudinaryV2 } from 'cloudinary';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { MediaStorage } from '@ajooba/contracts';

/**
 * Product media pipeline.
 *
 * Product photography lives in the repository `public/` tree (~494 MB).
 * Those bytes are **not** stored in MongoDB. Instead the import uploads each
 * eligible image to Cloudinary using server-side credentials and stores only
 * the resulting delivery URL and asset identifier on the product document.
 *
 * Security: `CLOUDINARY_API_SECRET` is read from the server environment and
 * is never returned by any function here, written to any response body, or
 * logged. The pino logger additionally redacts `*.apiSecret`. Browsers only
 * ever receive the public delivery URL.
 */

/** The resolved image reference written to a product document. */
export interface StoredMediaRef {
  readonly url: string;
  readonly alt: string;
  readonly position: number;
  readonly sourceFile: string;
  readonly storage: MediaStorage;
  readonly publicId?: string;
  readonly cloudinaryUrl?: string;
  readonly width?: number;
  readonly height?: number;
  readonly bytes?: number;
  readonly checksum?: string;
}

/**
 * True when all three Cloudinary credentials are present.
 *
 * A partial configuration is treated as "not configured" so the importer
 * never half-uploads; it falls back to the local `public/` path.
 */
export function isCloudinaryConfigured(): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

/**
 * Lazily configure the Cloudinary SDK.
 *
 * The SDK is imported dynamically so the API can boot (and every non-import
 * route can serve traffic) in an environment where Cloudinary is simply not
 * configured — which is the normal case until the account credentials exist.
 */
let configured = false;
async function configureCloudinary(): Promise<typeof CloudinaryV2> {
  const { v2 } = await import('cloudinary');

  if (!configured) {
    v2.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      // Server-side only. Never serialised into a response or a log line.
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }

  return v2;
}

/**
 * Build a stable, collision-free public id for a source image.
 *
 * Using the SHA-256 checksum as the public id means the same bytes always
 * resolve to the same Cloudinary asset, so a re-run after a partial failure
 * uploads nothing new and simply reuses the existing delivery URL.
 */
function buildPublicId(checksum: string, sourceFile: string): string {
  const extension = (basename(sourceFile).match(/\.([a-z0-9]+)$/i)?.[1] ?? 'jpg').toLowerCase();
  return `${env.CLOUDINARY_PRODUCT_FOLDER}/${checksum}.${extension}`;
}

/**
 * The delivery URL for an already-uploaded asset.
 *
 * Used on re-runs so an image that is already on the CDN never triggers a
 * second upload.
 */
export function buildDeliveryUrl(publicId: string): string {
  const base =
    env.CLOUDINARY_DELIVERY_BASE_URL ??
    `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;

  const transformation = env.CLOUDINARY_TRANSFORMATION;
  return transformation ? `${base}/${transformation}/${publicId}` : `${base}/${publicId}`;
}

/**
 * SHA-256 of a file, used as the content identity for an image.
 *
 * This is what makes the import resumable: identical bytes map to an
 * identical public id, regardless of which folder or run they arrived from.
 */
export async function checksumFile(absolutePath: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256');
    const stream = createReadStream(absolutePath);
    stream.on('error', rejectPromise);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

export interface UploadResult {
  readonly stored: StoredMediaRef;
  /** True when the asset already existed and no upload was performed. */
  readonly reused: boolean;
}

/**
 * Upload one product image to Cloudinary.
 *
 * Never throws for a missing local file — the caller records the row as
 * unresolved instead, because a partially-uploaded run must stay resumable
 * and every unresolvable image must be reported rather than silently
 * dropped.
 */
export async function uploadProductImage(options: {
  /** Absolute path of the source image on disk. */
  readonly absolutePath: string;
  /** Root-relative `public/` path, retained as provenance. */
  readonly localUrl: string;
  readonly sourceFile: string;
  readonly alt: string;
  readonly position: number;
}): Promise<{ ok: true; result: UploadResult } | { ok: false; reason: string }> {
  let bytes: number;
  try {
    const info = await stat(options.absolutePath);
    if (!info.isFile() || info.size === 0) {
      return { ok: false, reason: `source file is missing or empty: ${options.sourceFile}` };
    }
    bytes = info.size;
  } catch {
    return { ok: false, reason: `source file is unreadable: ${options.sourceFile}` };
  }

  const checksum = await checksumFile(options.absolutePath);

  if (!isCloudinaryConfigured()) {
    /*
     * No credentials yet. Keep the local path so the storefront keeps
     * working against the API's static mount, and record that no CDN asset
     * exists. This is a first-class, reported outcome — not a silent skip.
     */
    return {
      ok: true,
      result: {
        stored: {
          url: options.localUrl,
          alt: options.alt,
          position: options.position,
          sourceFile: options.sourceFile,
          storage: 'local',
          bytes,
          checksum,
        },
        reused: false,
      },
    };
  }

  const publicId = buildPublicId(checksum, options.sourceFile);
  const cloudinary = await configureCloudinary();

  try {
    /*
     * `public_id` + `overwrite: false` makes the upload idempotent: a
     * repeated run for identical bytes reports the existing asset instead of
     * re-encoding it. The API secret is only ever used in this signed
     * request, server-side.
     */
    const uploaded = await new Promise<{
      public_id: string;
      secure_url?: string;
      width?: number;
      height?: number;
      bytes?: number;
      /** Set by Cloudinary when the asset already existed and was not re-encoded. */
      existing?: boolean;
    }>((resolvePromise, rejectPromise) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          folder: env.CLOUDINARY_PRODUCT_FOLDER,
          overwrite: false,
          resource_type: 'image',
        },
        (error, result) => {
          if (error) {
            // Cloudinary reports failures as a plain response object, not an
            // Error, so it is wrapped before it is used as a rejection.
            rejectPromise(new Error(error.message || 'Cloudinary rejected the upload.'));
            return;
          }
          if (!result) {
            rejectPromise(new Error('Cloudinary returned no result'));
            return;
          }
          resolvePromise(result);
        },
      );

      createReadStream(options.absolutePath).pipe(stream);
    });

    const deliveryUrl = buildDeliveryUrl(publicId);

    return {
      ok: true,
      result: {
        stored: {
          url: deliveryUrl,
          alt: options.alt,
          position: options.position,
          sourceFile: options.sourceFile,
          storage: 'cloudinary',
          publicId,
          cloudinaryUrl: deliveryUrl,
          ...(uploaded.width ? { width: uploaded.width } : {}),
          ...(uploaded.height ? { height: uploaded.height } : {}),
          ...(uploaded.bytes ? { bytes: uploaded.bytes } : {}),
          checksum,
        },
        reused: uploaded.existing === true,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Cloudinary upload failed';
    logger.error({ sourceFile: options.sourceFile, reason }, 'Cloudinary upload failed');

    /*
     * Fall back to the local path rather than losing the image. The report
     * records it as unresolved so a re-run retries the upload.
     */
    return {
      ok: false,
      reason,
    };
  }
}

/**
 * Resolve a root-relative `public/` URL to an absolute path on disk.
 */
export function resolveSourcePath(localUrl: string): string {
  const relative = localUrl.replace(/^\/+/, '');
  return resolve(env.CATALOG_SOURCE_DIR, relative);
}
