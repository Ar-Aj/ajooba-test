import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

/**
 * Import payload staging.
 *
 * ## Why a staging area exists
 *
 * The original catalogue workbook lives on a developer's `C:` drive. Railway,
 * Vercel and every other deployment target cannot read it, and **must not be
 * able to**: a browser must never be able to name a path on the server and
 * have the server read it. That is an arbitrary-file-read primitive, and it
 * is why the import endpoint accepts an uploaded payload rather than a path.
 *
 * The flow is therefore:
 *
 *   1. The administrator uploads the extract JSON in the request body.
 *   2. It is written to a staging file whose name is generated **server-side**
 *      from the plan id — the client never supplies the stored filename.
 *   3. The plan records the checksum of those bytes.
 *   4. The apply reads the staged file back and re-verifies the checksum, so
 *      an approval cannot be pointed at content other than the report the
 *      operator actually read.
 *
 * ## Path safety
 *
 * `readStagedPayload` resolves the requested name inside the staging root and
 * refuses anything that escapes it. Both checks are deliberate: the filename
 * shape catches a tampered plan row, and the containment check catches
 * anything that slips past it.
 */

/** Where staged payloads live. The OS temp directory, never the repository. */
const STAGING_ROOT = resolve(tmpdir(), 'ajooba-import-staging');

/** The only filename shape that will ever be written or read. */
const SAFE_NAME = /^[A-Za-z0-9._-]{1,160}$/;

/** Assert a name is safe and resolves inside the staging root. */
function resolveStagedPath(name: string): string {
  if (!SAFE_NAME.test(name)) {
    throw new Error('Refusing to read a staged payload under an unsafe filename.');
  }

  const full = resolve(STAGING_ROOT, name);

  // Defence in depth: confirm the resolved path is genuinely inside the root.
  if (!full.startsWith(STAGING_ROOT + sep)) {
    throw new Error('Refusing to read a staged payload outside the staging area.');
  }

  return full;
}

/**
 * Write a payload to staging.
 *
 * Returns the stored name, which is derived from the server-generated plan id
 * and the payload's own checksum — never from anything the client sent.
 */
export function writeStagedPayload(planId: string, raw: string): string {
  const digest = createHash('sha256').update(raw, 'utf8').digest('hex');
  const name = `${planId}-${digest.slice(0, 16)}.json`;

  if (!SAFE_NAME.test(name)) {
    throw new Error('Refusing to stage a payload under an unsafe filename.');
  }

  mkdirSync(STAGING_ROOT, { recursive: true });
  writeFileSync(resolveStagedPath(name), raw, 'utf8');
  return name;
}

/**
 * Read a staged payload back.
 *
 * Throws when the file is missing, which is a real and expected outcome: a
 * server restart, a redeploy or a cleaned temp directory all remove it. The
 * message tells the operator to re-upload and re-plan rather than to retry.
 */
export function readStagedPayload(name: string): string {
  const full = resolveStagedPath(name);

  if (!existsSync(full)) {
    throw new Error(
      'The staged payload for this plan is no longer available on this server. ' +
        'Re-upload the source file and run a fresh dry run.',
    );
  }

  return readFileSync(full, 'utf8');
}

/** Remove a staged payload, e.g. once its plan has been applied. */
export function discardStagedPayload(name: string): void {
  try {
    const full = resolveStagedPath(name);
    if (existsSync(full)) {
      unlinkSync(full);
    }
  } catch {
    // Discarding is best-effort; a leftover staged file is inert.
  }
}
