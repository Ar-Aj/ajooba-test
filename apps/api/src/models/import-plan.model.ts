import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Catalogue import plans (G-6).
 *
 * A plan is the report an operator reads **before** an import writes
 * anything, and the record the apply is authorised against. It holds:
 *
 *  - which database the import targets, so the operator can confirm it;
 *  - the checksum of the exact payload the plan was built from, so an apply
 *    cannot be pointed at different content than the report describes;
 *  - per-row findings, so every quarantined or rejected row is visible and
 *    attributable rather than silently dropped;
 *  - who ran the dry run and who authorised the apply, kept as separate
 *    fields so self-approval is visible in the record.
 */

/** The lifecycle of an import plan. */
export const IMPORT_PLAN_STATUSES = [
  'dry-run',
  'approved',
  'applied',
  'failed',
  'superseded',
] as const;

export type ImportPlanStatus = (typeof IMPORT_PLAN_STATUSES)[number];

const importPlanSchema = new Schema(
  {
    /** Opaque id returned to the administrator. */
    planId: { type: String, required: true, unique: true, index: true },

    status: {
      type: String,
      enum: IMPORT_PLAN_STATUSES,
      required: true,
      default: 'dry-run',
      index: true,
    },

    /**
     * The database this plan would write to, as reported by the running
     * connection. Stated so an operator can confirm the target before
     * approving — the same information the CLI guard acts on.
     */
    targetDatabase: { type: String, required: true },

    /** Filename the administrator uploaded, for provenance only. */
    sourceFilename: { type: String, required: true },

    /** SHA-256 of the payload. An apply must present the same payload. */
    payloadChecksum: { type: String, required: true },

    /** Staged filename, derived server-side. Never supplied by a client. */
    stagedPath: { type: String, required: true },

    /** Bytes received. */
    payloadBytes: { type: Number, required: true },

    /** Counts an operator needs before approving. */
    counts: {
      designsToCreate: { type: Number, default: 0 },
      designsToUpdate: { type: Number, default: 0 },
      variantsToCreate: { type: Number, default: 0 },
      variantsToUpdate: { type: Number, default: 0 },
      quarantine: { type: Number, default: 0 },
      reject: { type: Number, default: 0 },
      conflicts: { type: Number, default: 0 },
    },

    /** Per-row detail, capped by the planner so one plan cannot be unbounded. */
    findings: { type: [Schema.Types.Mixed], default: [] },

    /** Who ran the dry run. */
    requestedByEmail: { type: String },

    /**
     * Who authorised the apply. Distinct from who requested it, so a plan
     * that was self-approved is visible as such in the record.
     */
    approvedByEmail: { type: String },
    approvedAt: { type: Date },

    appliedAt: { type: Date },

    /** Outcome of the apply, present only after one. */
    result: { type: Schema.Types.Mixed },
  },
  { collection: 'import-plans', timestamps: true },
);

export type ImportPlanDocument = InferSchemaType<typeof importPlanSchema>;

export const ImportPlanModel =
  (mongoose.models.ImportPlan as mongoose.Model<ImportPlanDocument> | undefined) ??
  mongoose.model<ImportPlanDocument>('ImportPlan', importPlanSchema);
