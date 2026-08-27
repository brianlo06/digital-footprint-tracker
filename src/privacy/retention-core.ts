import type { Database } from "@/database/client";
import { sql } from "drizzle-orm";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1_000;
const DEFAULT_ORPHAN_AUDIT_RETENTION_DAYS = 365;
const DEFAULT_SCAN_JOB_RETENTION_DAYS = 90;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export interface RetentionMaintenanceOptions {
  readonly now?: Date;
  readonly batchSize?: number;
  readonly orphanAuditRetentionDays?: number;
  readonly scanJobRetentionDays?: number;
}

export interface RetentionMaintenanceResult {
  readonly expiredVerifications: number;
  readonly deletedReceipts: number;
  readonly deletedOrphanAuditEvents: number;
  readonly deletedScanJobs: number;
}

interface RetentionMaintenanceRow {
  readonly expiredVerifications: number;
  readonly deletedReceipts: number;
  readonly deletedOrphanAuditEvents: number;
  readonly deletedScanJobs: number;
}

export function assertRetentionMaintenanceOptions(options: RetentionMaintenanceOptions): void {
  if (
    options.now !== undefined &&
    (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime()))
  ) {
    throw new Error("RETENTION_NOW_INVALID");
  }

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const orphanAuditRetentionDays =
    options.orphanAuditRetentionDays ?? DEFAULT_ORPHAN_AUDIT_RETENTION_DAYS;
  const scanJobRetentionDays = options.scanJobRetentionDays ?? DEFAULT_SCAN_JOB_RETENTION_DAYS;

  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("RETENTION_BATCH_SIZE_INVALID");
  }
  if (!Number.isSafeInteger(orphanAuditRetentionDays) || orphanAuditRetentionDays < 1) {
    throw new Error("AUDIT_RETENTION_DAYS_INVALID");
  }
  if (!Number.isSafeInteger(scanJobRetentionDays) || scanJobRetentionDays < 1) {
    throw new Error("SCAN_JOB_RETENTION_DAYS_INVALID");
  }

  const now = options.now ?? new Date();
  const auditCutoff = new Date(now.getTime() - orphanAuditRetentionDays * MILLISECONDS_PER_DAY);
  if (!Number.isFinite(auditCutoff.getTime())) throw new Error("AUDIT_RETENTION_DAYS_INVALID");
  const scanJobCutoff = new Date(now.getTime() - scanJobRetentionDays * MILLISECONDS_PER_DAY);
  if (!Number.isFinite(scanJobCutoff.getTime())) {
    throw new Error("SCAN_JOB_RETENTION_DAYS_INVALID");
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
  const scanJobRetentionDays = options.scanJobRetentionDays ?? DEFAULT_SCAN_JOB_RETENTION_DAYS;

  assertRetentionMaintenanceOptions(options);

  const orphanAuditCutoff = new Date(
    now.getTime() - orphanAuditRetentionDays * MILLISECONDS_PER_DAY,
  );
  const scanJobCutoff = new Date(now.getTime() - scanJobRetentionDays * MILLISECONDS_PER_DAY);

  const rows = await database.execute(sql<RetentionMaintenanceRow>`
    select
      expired_verifications as "expiredVerifications",
      deleted_receipts as "deletedReceipts",
      deleted_orphan_audit_events as "deletedOrphanAuditEvents",
      deleted_scan_jobs as "deletedScanJobs"
    from public.run_retention_maintenance(
      ${now.toISOString()}::timestamptz,
      ${batchSize}::integer,
      ${orphanAuditCutoff.toISOString()}::timestamptz,
      ${scanJobCutoff.toISOString()}::timestamptz
    )
  `);
  const [result] = rows as unknown as RetentionMaintenanceRow[];
  if (!result) throw new Error("RETENTION_MAINTENANCE_FAILED");

  return result;
}
