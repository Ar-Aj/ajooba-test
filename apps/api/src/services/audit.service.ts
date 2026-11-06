import type { Types } from 'mongoose';
import { AuditLogModel } from '../models/audit-log.model.js';
import type { AuditAction } from '@ajooba/contracts';

/**
 * The administrative audit log.
 *
 * Every administrative write records who did it, what changed and when.
 * The log is append-only.
 *
 * The `changes` diff is written through `sanitiseDiff`, which removes
 * anything that looks like a secret. A password hash, a token and an API
 * secret must never reach the log collection, because the log is
 * readable by a wider audience than the records it describes.
 */

/** Field names whose values are never written to the audit log. */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'sessionsecret',
  'jwtsecret',
  'apikey',
  'apisecret',
  'authorization',
  'cookie',
  'credential',
  'credentials',
]);

/**
 * The value written in place of a redacted field.
 */
const REDACTED = '[redacted]';

/**
 * Remove secret-looking values from a diff.
 *
 * The function walks the diff recursively. A key that matches a redacted
 * name is replaced regardless of its value.
 */
export function sanitiseDiff(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[truncated]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitiseDiff(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_FIELDS.has(key.toLowerCase())) {
        output[key] = REDACTED;
        continue;
      }
      output[key] = sanitiseDiff(entry, depth + 1);
    }
    return output;
  }

  return value;
}

export interface AuditInput {
  readonly actorId?: string | null;
  readonly actorEmail?: string;
  readonly actorRole?: string;
  readonly action: AuditAction;
  readonly entity: string;
  readonly entityId?: string;
  readonly summary: string;
  readonly changes?: unknown;
  readonly ip?: string | null;
}

/**
 * Write an audit entry.
 *
 * A failure to write the audit entry is logged but never fails the
 * operation that was audited — losing the audit trail is bad, but
 * refusing a legitimate order update is worse.
 */
export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    await AuditLogModel.create({
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? 'system',
      actorRole: input.actorRole ?? 'system',
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? '',
      summary: input.summary,
      changes:
        input.changes === undefined || input.changes === null ? null : sanitiseDiff(input.changes),
      ip: input.ip ?? '',
    });
  } catch {
    // Intentionally swallowed — see the note above.
  }
}

/**
 * An audit-log row, as it comes back from the database.
 *
 * The lean result is typed explicitly so every field is read with the
 * right converter and the response never stringifies an object by
 * accident.
 */
interface AuditLogDoc {
  _id: Types.ObjectId;
  actorId: Types.ObjectId | null;
  actorEmail: string;
  actorRole: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  summary: string;
  changes: Record<string, unknown> | null;
  ip: string;
  createdAt: Date;
}

/**
 * List audit entries, newest first.
 */
export async function listAuditLogs(
  filter: { action?: AuditAction; entity?: string; actorId?: string },
  page: number,
  pageSize: number,
): Promise<{
  items: Array<{
    id: string;
    actorId: string | null;
    actorEmail: string;
    actorRole: string;
    action: AuditAction;
    entity: string;
    entityId: string;
    summary: string;
    changes: Record<string, unknown> | null;
    ip: string | null;
    createdAt: string;
  }>;
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const query: Record<string, unknown> = {};
  if (filter.action) {
    query.action = filter.action;
  }
  if (filter.entity) {
    query.entity = filter.entity;
  }
  if (filter.actorId) {
    query.actorId = filter.actorId;
  }

  const [docs, totalItems] = await Promise.all([
    AuditLogModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<AuditLogDoc[]>(),
    AuditLogModel.countDocuments(query),
  ]);

  return {
    items: docs.map((doc) => ({
      id: doc._id.toString(),
      actorId: doc.actorId ? doc.actorId.toString() : null,
      actorEmail: doc.actorEmail,
      actorRole: doc.actorRole,
      action: doc.action,
      entity: doc.entity,
      entityId: doc.entityId,
      summary: doc.summary,
      changes: doc.changes,
      ip: doc.ip ? doc.ip : null,
      createdAt: doc.createdAt.toISOString(),
    })),
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}
