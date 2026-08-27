import type { Database } from "@/database/client";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;
const DEFAULT_LEASE_SECONDS = 120;
const MIN_LEASE_SECONDS = 30;
const MAX_LEASE_SECONDS = 900;

export interface ClaimBreachScanJobsOptions {
  readonly now?: Date;
  readonly batchSize?: number;
  readonly leaseSeconds?: number;
  readonly scanId?: string;
}

export interface ClaimedBreachScanJob {
  readonly jobId: string;
  readonly scanId: string;
  readonly userId: string;
  readonly identityId: string;
  readonly identifierId: string;
  readonly consentRecordId: string;
  readonly authSubject: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly leaseToken: string;
}

type ClaimedBreachScanJobRow = Omit<ClaimedBreachScanJob, "leaseToken">;

export function assertBreachScanClaimOptions(options: ClaimBreachScanJobsOptions): void {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("SCAN_JOB_BATCH_SIZE_INVALID");
  }
  if (
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < MIN_LEASE_SECONDS ||
    leaseSeconds > MAX_LEASE_SECONDS
  ) {
    throw new Error("SCAN_JOB_LEASE_SECONDS_INVALID");
  }
}

/** Claims a bounded, crash-recoverable batch through one security-definer
 * transition. The returned auth subject is used only to restore tenant RLS
 * inside the worker transaction and is never passed to a provider. */
export async function claimBreachScanJobs(
  database: Database,
  options: ClaimBreachScanJobsOptions = {},
): Promise<readonly ClaimedBreachScanJob[]> {
  assertBreachScanClaimOptions(options);
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const leaseToken = randomBytes(32).toString("base64url");

  const rows = await database.execute(sql<ClaimedBreachScanJobRow>`
    select
      job_id as "jobId",
      scan_id as "scanId",
      user_id as "userId",
      identity_id as "identityId",
      identifier_id as "identifierId",
      consent_record_id as "consentRecordId",
      auth_subject as "authSubject",
      attempt_count as "attemptCount",
      max_attempts as "maxAttempts"
    from public.claim_breach_scan_jobs(
      ${now.toISOString()}::timestamptz,
      ${batchSize}::integer,
      ${leaseSeconds}::integer,
      ${leaseToken}::text,
      ${options.scanId ?? null}::uuid
    )
  `);

  return (rows as unknown as ClaimedBreachScanJobRow[]).map((row) => ({ ...row, leaseToken }));
}

export function breachScanClaimsEnabled(killSwitch: string | undefined): boolean {
  return killSwitch === "false";
}

export function retryDelaySeconds(attemptCount: number): number {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error("SCAN_JOB_ATTEMPT_COUNT_INVALID");
  }
  return Math.min(15 * 2 ** (attemptCount - 1), 15 * 60);
}
