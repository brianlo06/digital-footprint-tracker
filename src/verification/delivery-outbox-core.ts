import type { Database } from "@/database/client";
import type { EncryptedEnvelope } from "@/security/crypto";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";

const DEFAULT_CLAIM_BATCH_SIZE = 25;
const MAX_CLAIM_BATCH_SIZE = 200;
const DEFAULT_CLAIM_LEASE_SECONDS = 120;
const MIN_CLAIM_LEASE_SECONDS = 30;
const MAX_CLAIM_LEASE_SECONDS = 900;
const MAX_RETRY_AFTER_SECONDS = 3600;

export interface ClaimVerificationDeliveriesOptions {
  readonly now?: Date;
  readonly batchSize?: number;
  readonly leaseSeconds?: number;
}

export interface ClaimedVerificationDelivery {
  readonly deliveryId: string;
  readonly verificationId: string;
  readonly channel: "EMAIL";
  readonly template: string;
  readonly encryptedPayload: EncryptedEnvelope;
  readonly attemptCount: number;
  readonly leaseToken: string;
}

interface ClaimedVerificationDeliveryRow {
  readonly deliveryId: string;
  readonly verificationId: string;
  readonly channel: "EMAIL";
  readonly template: string;
  readonly encryptedPayload: EncryptedEnvelope;
  readonly attemptCount: number;
}

export type CompleteVerificationDeliveryOutcome = "COMPLETED" | "NOT_FOUND" | "LEASE_MISMATCH";

export type ReportVerificationDeliveryFailureOutcome =
  "RETRY_SCHEDULED" | "DEAD_LETTERED" | "NOT_FOUND" | "LEASE_MISMATCH";

export interface ReportVerificationDeliveryFailureOptions {
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly outcome: "TRANSIENT" | "PERMANENT";
  readonly retryAfterSeconds?: number;
  readonly now?: Date;
}

export function assertClaimOptions(options: ClaimVerificationDeliveriesOptions): void {
  const batchSize = options.batchSize ?? DEFAULT_CLAIM_BATCH_SIZE;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_CLAIM_LEASE_SECONDS;

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_CLAIM_BATCH_SIZE) {
    throw new Error("DELIVERY_CLAIM_BATCH_SIZE_INVALID");
  }
  if (
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < MIN_CLAIM_LEASE_SECONDS ||
    leaseSeconds > MAX_CLAIM_LEASE_SECONDS
  ) {
    throw new Error("DELIVERY_CLAIM_LEASE_SECONDS_INVALID");
  }
}

export function assertReportFailureOptions(
  options: ReportVerificationDeliveryFailureOptions,
): void {
  if (options.retryAfterSeconds === undefined) return;
  if (
    !Number.isInteger(options.retryAfterSeconds) ||
    options.retryAfterSeconds < 0 ||
    options.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS
  ) {
    throw new Error("DELIVERY_RETRY_AFTER_SECONDS_INVALID");
  }
}

/**
 * Claims one bounded batch under a single, freshly generated lease token
 * shared by every row this call claims - correct because the CAS in
 * complete/report-failure only needs to distinguish this claim operation
 * from any other, which a per-call token already does.
 */
export async function claimVerificationDeliveries(
  database: Database,
  options: ClaimVerificationDeliveriesOptions = {},
): Promise<readonly ClaimedVerificationDelivery[]> {
  assertClaimOptions(options);
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DEFAULT_CLAIM_BATCH_SIZE;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_CLAIM_LEASE_SECONDS;
  const leaseToken = randomBytes(32).toString("base64url");

  const rows = await database.execute(sql<ClaimedVerificationDeliveryRow>`
    select
      delivery_id as "deliveryId",
      verification_id as "verificationId",
      channel,
      template,
      encrypted_payload as "encryptedPayload",
      attempt_count as "attemptCount"
    from public.claim_verification_deliveries(
      ${now.toISOString()}::timestamptz,
      ${batchSize}::integer,
      ${leaseSeconds}::integer,
      ${leaseToken}::text
    )
  `);

  return (rows as unknown as ClaimedVerificationDeliveryRow[]).map((row) => ({
    ...row,
    leaseToken,
  }));
}

export async function completeVerificationDelivery(
  database: Database,
  deliveryId: string,
  leaseToken: string,
  now: Date = new Date(),
): Promise<CompleteVerificationDeliveryOutcome> {
  const rows = await database.execute(sql<{ outcome: string }>`
    select public.complete_verification_delivery(
      ${now.toISOString()}::timestamptz,
      ${deliveryId}::uuid,
      ${leaseToken}::text
    ) as outcome
  `);
  const [result] = rows as unknown as { outcome: string }[];
  if (!result) throw new Error("DELIVERY_COMPLETE_FAILED");
  return result.outcome as CompleteVerificationDeliveryOutcome;
}

export async function reportVerificationDeliveryFailure(
  database: Database,
  options: ReportVerificationDeliveryFailureOptions,
): Promise<ReportVerificationDeliveryFailureOutcome> {
  assertReportFailureOptions(options);
  const now = options.now ?? new Date();

  const rows = await database.execute(sql<{ outcome: string }>`
    select public.report_verification_delivery_failure(
      ${now.toISOString()}::timestamptz,
      ${options.deliveryId}::uuid,
      ${options.leaseToken}::text,
      ${options.outcome}::text,
      ${options.retryAfterSeconds ?? null}::integer
    ) as outcome
  `);
  const [result] = rows as unknown as { outcome: string }[];
  if (!result) throw new Error("DELIVERY_REPORT_FAILURE_FAILED");
  return result.outcome as ReportVerificationDeliveryFailureOutcome;
}
