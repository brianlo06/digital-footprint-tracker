import type { Database } from "@/database/client";
import { sql } from "drizzle-orm";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1_000;
const DEFAULT_ORPHAN_AUDIT_RETENTION_DAYS = 365;

export interface RetentionMaintenanceOptions {
  readonly now?: Date;
  readonly batchSize?: number;
  readonly orphanAuditRetentionDays?: number;
}

export interface RetentionMaintenanceResult {
  readonly expiredVerifications: number;
  readonly deletedReceipts: number;
  readonly deletedOrphanAuditEvents: number;
}

interface RetentionMaintenanceRow {
  readonly expiredVerifications: number;
  readonly deletedReceipts: number;
  readonly deletedOrphanAuditEvents: number;
}

export function assertRetentionMaintenanceOptions(options: RetentionMaintenanceOptions): void {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const orphanAuditRetentionDays =
    options.orphanAuditRetentionDays ?? DEFAULT_ORPHAN_AUDIT_RETENTION_DAYS;

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("RETENTION_BATCH_SIZE_INVALID");
  }
  if (!Number.isInteger(orphanAuditRetentionDays) || orphanAuditRetentionDays < 1) {
    throw new Error("AUDIT_RETENTION_DAYS_INVALID");
  }
}

export async function executeRetentionMaintenance(
  database: Database,
  options: RetentionMaintenanceOptions = {},
): Promise<RetentionMaintenanceResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const orphanAuditRetentionDays =
    options.orphanAuditRetentionDays ?? DEFAULT_ORPHAN_AUDIT_RETENTION_DAYS;

  assertRetentionMaintenanceOptions(options);

  const orphanAuditCutoff = new Date(
    now.getTime() - orphanAuditRetentionDays * 24 * 60 * 60 * 1_000,
  );

  const rows = await database.execute(sql<RetentionMaintenanceRow>`
    select
      expired_verifications as "expiredVerifications",
      deleted_receipts as "deletedReceipts",
      deleted_orphan_audit_events as "deletedOrphanAuditEvents"
    from public.run_retention_maintenance(
      ${now.toISOString()}::timestamptz,
      ${batchSize}::integer,
      ${orphanAuditCutoff.toISOString()}::timestamptz
    )
  `);
  const [result] = rows as unknown as RetentionMaintenanceRow[];
  if (!result) throw new Error("RETENTION_MAINTENANCE_FAILED");

  return result;
}
