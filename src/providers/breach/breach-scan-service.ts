import "server-only";

import type { AccountContext } from "@/core/account-service";
import type { CandidateFinding, ProviderHealth } from "@/core/domain.types";
import type { BreachInvocationAuthorizationStore } from "@/providers/breach/breach-invocation-service";
import { executeSyntheticBreachInvocation } from "@/providers/breach/breach-invocation-service";
import { ProviderContractError } from "@/providers/provider.contracts";
import type { BreachProviderSelection } from "@/providers/provider-registry";
import type { ProviderUsageBudget, ProviderUsageLedger } from "@/providers/provider-usage-ledger";

export const BREACH_SCAN_REQUESTED_CAPABILITY = "BREACH_METADATA_BY_VERIFIED_EMAIL";
const FALLBACK_ERROR_SAFE_CODE = "PROVIDER_SCAN_FAILED";

/**
 * The zero-network synthetic adapter's `estimateCost` always returns 0, so
 * cost limits stay at USD-0/zero units per `docs/PHASE_2_READINESS.md` —
 * only the request-count allowance is explicitly nonzero, and only for the
 * synthetic-only, local-only, feature-flagged path this budget is used on.
 */
export const SYNTHETIC_BREACH_SCAN_BUDGET: ProviderUsageBudget = {
  maxUserDailyRequests: 5,
  maxProviderDailyRequests: 20,
  maxProviderMonthlyRequests: 100,
  maxProviderDailyCostUnits: 0,
  maxProviderMonthlyCostUnits: 0,
};

/**
 * A provider run that returned results but reported anything other than
 * HEALTHY finished with coverage that is not guaranteed complete, so the scan
 * is recorded as PARTIAL. `docs/PRODUCT.md` requires that a partial scan never
 * imply full coverage; claiming COMPLETED here would present a rate-limited or
 * degraded check as an exhaustive one.
 */
export function scanOutcomeForProviderHealth(
  healthOutcome: ProviderHealth,
): "COMPLETED" | "PARTIAL" {
  return healthOutcome === "HEALTHY" ? "COMPLETED" : "PARTIAL";
}

/** Thrown by a ScanRunRepository.createScan implementation when the
 * account already has a RUNNING scan for the same capability (enforced by
 * a partial unique index at the storage layer). */
export class ScanAlreadyRunningError extends Error {
  constructor() {
    super("SCAN_ALREADY_RUNNING");
    this.name = "ScanAlreadyRunningError";
  }
}

export interface EligibleBreachTarget {
  readonly identifierId: string;
  readonly consentRecordId: string;
}

export interface ScanRunRepository {
  findEligibleTarget(account: AccountContext): Promise<EligibleBreachTarget | null>;
  createScan(input: {
    readonly userId: string;
    readonly identityId: string;
    readonly requestedCapability: string;
  }): Promise<string>;
  createProviderRun(input: {
    readonly scanId: string;
    readonly userId: string;
    readonly providerId: string;
    readonly capability: string;
  }): Promise<string>;
  completeProviderRun(
    input:
      | {
          readonly providerRunId: string;
          readonly outcome: "COMPLETED";
          readonly resultCount: number;
          readonly healthOutcome?: string;
          readonly reservationId?: string;
        }
      | {
          readonly providerRunId: string;
          readonly outcome: "FAILED";
          readonly errorSafeCode: string;
          readonly reservationId?: string;
        },
  ): Promise<void>;
  completeScan(input: {
    readonly scanId: string;
    readonly outcome: "COMPLETED" | "PARTIAL" | "FAILED";
  }): Promise<void>;
  insertBreachFindings(input: {
    readonly providerRunId: string;
    readonly userId: string;
    readonly identityId: string;
    readonly checkedAt: Date;
    readonly parserVersion: string;
    readonly candidates: readonly CandidateFinding[];
  }): Promise<void>;
}

export type BreachScanResult =
  | { readonly status: "PROVIDER_DISABLED" }
  | { readonly status: "NO_ELIGIBLE_TARGET" }
  | { readonly status: "ALREADY_RUNNING" }
  | {
      readonly status: "COMPLETED";
      readonly scanId: string;
      readonly providerRunId: string;
      readonly findingCount: number;
    }
  | {
      readonly status: "DENIED";
      readonly scanId: string;
      readonly providerRunId: string;
      readonly reason: string;
    }
  | {
      readonly status: "UNEXPECTED_REPLAY";
      readonly scanId: string;
      readonly providerRunId: string;
    };

function providerErrorSafeCode(error: unknown): string {
  if (error instanceof ProviderContractError) return error.descriptor.safeCode;
  return FALLBACK_ERROR_SAFE_CODE;
}

/**
 * Orchestrates one user-triggered breach scan: creates the scan/provider-run
 * rows, delegates authorization and dispatch to the existing invocation
 * service unchanged, then persists normalized findings or a terminal safe
 * failure code. Persistence-neutral; a Postgres transaction binds the
 * repository, authorization store, and usage ledger together.
 */
export async function executeSyntheticBreachScan(input: {
  readonly account: AccountContext;
  readonly now: Date;
  readonly providerSelection: BreachProviderSelection;
  readonly repository: ScanRunRepository;
  readonly authorizationStore: BreachInvocationAuthorizationStore;
  readonly usageLedger: ProviderUsageLedger;
  readonly usageBudget?: ProviderUsageBudget;
}): Promise<BreachScanResult> {
  const provider = input.providerSelection.provider;
  if (input.providerSelection.status !== "ENABLED_SYNTHETIC" || !provider) {
    return { status: "PROVIDER_DISABLED" };
  }

  const target = await input.repository.findEligibleTarget(input.account);
  if (!target) return { status: "NO_ELIGIBLE_TARGET" };

  let scanId: string;
  try {
    scanId = await input.repository.createScan({
      userId: input.account.userId,
      identityId: input.account.identityId,
      requestedCapability: BREACH_SCAN_REQUESTED_CAPABILITY,
    });
  } catch (error) {
    if (error instanceof ScanAlreadyRunningError) return { status: "ALREADY_RUNNING" };
    throw error;
  }
  const providerRunId = await input.repository.createProviderRun({
    scanId,
    userId: input.account.userId,
    providerId: provider.id,
    capability: BREACH_SCAN_REQUESTED_CAPABILITY,
  });

  const deadline = new Date(input.now.getTime() + 30_000).toISOString();
  const command = {
    userId: input.account.userId,
    identityId: input.account.identityId,
    identifierId: target.identifierId,
    consentRecordId: target.consentRecordId,
    scanId,
    providerRunId,
    idempotencyKey: `scan:${scanId}`,
    deadline,
    maxResults: 10,
  };

  try {
    const result = await executeSyntheticBreachInvocation({
      command,
      now: input.now,
      providerSelection: input.providerSelection,
      authorizationStore: input.authorizationStore,
      usageLedger: input.usageLedger,
      usageBudget: input.usageBudget,
    });

    if (result.status === "COMPLETED") {
      await input.repository.insertBreachFindings({
        providerRunId,
        userId: input.account.userId,
        identityId: input.account.identityId,
        checkedAt: input.now,
        parserVersion: provider.parserVersion,
        candidates: result.candidates,
      });
      const healthOutcome = await provider.healthCheck();
      await input.repository.completeProviderRun({
        providerRunId,
        outcome: "COMPLETED",
        resultCount: result.candidates.length,
        healthOutcome,
        reservationId: result.reservationId,
      });
      await input.repository.completeScan({
        scanId,
        outcome: scanOutcomeForProviderHealth(healthOutcome),
      });
      return { status: "COMPLETED", scanId, providerRunId, findingCount: result.candidates.length };
    }

    if (result.status === "DENIED") {
      await input.repository.completeProviderRun({
        providerRunId,
        outcome: "FAILED",
        errorSafeCode: result.reason,
      });
      await input.repository.completeScan({ scanId, outcome: "FAILED" });
      return { status: "DENIED", scanId, providerRunId, reason: result.reason };
    }

    // IN_PROGRESS / ALREADY_PROCESSED: unreachable in practice since every
    // scan mints a fresh idempotency key, but handled defensively.
    await input.repository.completeProviderRun({
      providerRunId,
      outcome: "FAILED",
      errorSafeCode: "UNEXPECTED_REPLAY",
      reservationId: result.reservationId,
    });
    await input.repository.completeScan({ scanId, outcome: "FAILED" });
    return { status: "UNEXPECTED_REPLAY", scanId, providerRunId };
  } catch (error) {
    await input.repository.completeProviderRun({
      providerRunId,
      outcome: "FAILED",
      errorSafeCode: providerErrorSafeCode(error),
    });
    await input.repository.completeScan({ scanId, outcome: "FAILED" });
    throw error;
  }
}
