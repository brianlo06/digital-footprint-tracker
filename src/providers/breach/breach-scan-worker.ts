import type { DatabaseTransaction } from "@/database/client";
import { scanJobs, scans } from "@/database/schema";
import {
  executeSyntheticBreachInvocation,
  type BreachInvocationAuthorizationStore,
} from "@/providers/breach/breach-invocation-service";
import {
  BREACH_SCAN_REQUESTED_CAPABILITY,
  scanOutcomeForProviderHealth,
  SYNTHETIC_BREACH_SCAN_BUDGET,
} from "@/providers/breach/breach-scan-service";
import type { ClaimedBreachScanJob } from "@/providers/breach/breach-scan-job-core";
import { retryDelaySeconds } from "@/providers/breach/breach-scan-job-core";
import { PostgresBreachScanRepository } from "@/providers/breach/postgres-breach-scan-repository";
import { ProviderContractError } from "@/providers/provider.contracts";
import type { BreachProviderSelection } from "@/providers/provider-registry";
import type { ProviderUsageBudget, ProviderUsageLedger } from "@/providers/provider-usage-ledger";
import { and, eq, sql } from "drizzle-orm";

const FALLBACK_ERROR_SAFE_CODE = "PROVIDER_SCAN_FAILED";

export type ProcessClaimedBreachScanResult =
  "SKIPPED" | "COMPLETED" | "RETRY_SCHEDULED" | "DEAD_LETTERED";

function safeProviderError(error: unknown): {
  readonly safeCode: string;
  readonly retryable: boolean;
} {
  if (error instanceof ProviderContractError) {
    return {
      safeCode: error.descriptor.safeCode,
      retryable: error.descriptor.retryable,
    };
  }
  return { safeCode: FALLBACK_ERROR_SAFE_CODE, retryable: false };
}

/**
 * Processes one leased, synthetic-only job under its tenant's RLS context.
 * The caller must begin the transaction and set app.auth_subject before
 * calling. A row lock makes cancellation and lease completion a single-writer
 * state transition for this attempt.
 */
export async function processClaimedSyntheticBreachScan(input: {
  readonly transaction: DatabaseTransaction;
  readonly job: ClaimedBreachScanJob;
  readonly now: Date;
  readonly providerSelection: BreachProviderSelection;
  readonly authorizationStore: BreachInvocationAuthorizationStore;
  readonly usageLedger: ProviderUsageLedger;
  readonly usageBudget?: ProviderUsageBudget;
}): Promise<ProcessClaimedBreachScanResult> {
  const { transaction, job } = input;
  const [lockedJob] = await transaction
    .select({ id: scanJobs.id })
    .from(scanJobs)
    .where(
      and(
        eq(scanJobs.id, job.jobId),
        eq(scanJobs.scanId, job.scanId),
        eq(scanJobs.userId, job.userId),
        eq(scanJobs.state, "CLAIMED"),
        eq(scanJobs.leaseToken, job.leaseToken),
        sql`${scanJobs.leaseExpiresAt} > ${input.now.toISOString()}::timestamptz`,
      ),
    )
    .for("update");
  if (!lockedJob) return "SKIPPED";

  const provider = input.providerSelection.provider;
  if (input.providerSelection.status !== "ENABLED_SYNTHETIC" || !provider) {
    await finishJob(input, "PROVIDER_DISABLED", false);
    return "DEAD_LETTERED";
  }

  const repository = new PostgresBreachScanRepository(transaction);
  const providerRunId = await repository.createProviderRun({
    scanId: job.scanId,
    userId: job.userId,
    providerId: provider.id,
    capability: BREACH_SCAN_REQUESTED_CAPABILITY,
  });
  const command = {
    userId: job.userId,
    identityId: job.identityId,
    identifierId: job.identifierId,
    consentRecordId: job.consentRecordId,
    scanId: job.scanId,
    providerRunId,
    idempotencyKey: `scan:${job.scanId}:attempt:${job.attemptCount}`,
    deadline: new Date(input.now.getTime() + 30_000).toISOString(),
    maxResults: 10,
  };

  try {
    const result = await executeSyntheticBreachInvocation({
      command,
      now: input.now,
      providerSelection: input.providerSelection,
      authorizationStore: input.authorizationStore,
      usageLedger: input.usageLedger,
      usageBudget: input.usageBudget ?? SYNTHETIC_BREACH_SCAN_BUDGET,
    });

    if (result.status !== "COMPLETED") {
      const safeCode = result.status === "DENIED" ? result.reason : "UNEXPECTED_REPLAY";
      await repository.completeProviderRun({
        providerRunId,
        outcome: "FAILED",
        errorSafeCode: safeCode,
        reservationId: "reservationId" in result ? result.reservationId : undefined,
      });
      await finishJob(input, safeCode, false);
      return "DEAD_LETTERED";
    }

    const healthOutcome = await provider.healthCheck();
    await repository.insertBreachFindings({
      providerRunId,
      userId: job.userId,
      identityId: job.identityId,
      checkedAt: input.now,
      parserVersion: provider.parserVersion,
      candidates: result.candidates,
    });
    await repository.completeProviderRun({
      providerRunId,
      outcome: "COMPLETED",
      resultCount: result.candidates.length,
      healthOutcome,
      reservationId: result.reservationId,
    });
    await transaction
      .update(scanJobs)
      .set({
        state: "COMPLETED",
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(scanJobs.id, job.jobId), eq(scanJobs.leaseToken, job.leaseToken)));
    await repository.completeScan({
      scanId: job.scanId,
      outcome: scanOutcomeForProviderHealth(healthOutcome),
    });
    return "COMPLETED";
  } catch (error) {
    const descriptor = safeProviderError(error);
    await repository.completeProviderRun({
      providerRunId,
      outcome: "FAILED",
      errorSafeCode: descriptor.safeCode,
    });
    const retryable = descriptor.retryable && job.attemptCount < job.maxAttempts;
    await finishJob(input, descriptor.safeCode, retryable);
    return retryable ? "RETRY_SCHEDULED" : "DEAD_LETTERED";
  }
}

async function finishJob(
  input: {
    readonly transaction: DatabaseTransaction;
    readonly job: ClaimedBreachScanJob;
    readonly now: Date;
  },
  safeCode: string,
  retryable: boolean,
): Promise<void> {
  const { transaction, job } = input;
  if (retryable) {
    const notBefore = new Date(input.now.getTime() + retryDelaySeconds(job.attemptCount) * 1_000);
    await transaction
      .update(scanJobs)
      .set({
        state: "PENDING",
        notBefore,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorSafeCode: safeCode,
        updatedAt: sql`now()`,
      })
      .where(and(eq(scanJobs.id, job.jobId), eq(scanJobs.leaseToken, job.leaseToken)));
    await transaction
      .update(scans)
      .set({ state: "QUEUED" })
      .where(and(eq(scans.id, job.scanId), eq(scans.state, "RUNNING")));
    return;
  }

  await transaction
    .update(scanJobs)
    .set({
      state: "DEAD_LETTERED",
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorSafeCode: safeCode,
      updatedAt: sql`now()`,
    })
    .where(and(eq(scanJobs.id, job.jobId), eq(scanJobs.leaseToken, job.leaseToken)));
  await transaction
    .update(scans)
    .set({ state: "FAILED", completedAt: sql`now()` })
    .where(and(eq(scans.id, job.scanId), eq(scans.state, "RUNNING")));
}
