import "server-only";

import type { AccountContext } from "@/core/account-service";
import { withRuntimeDatabase } from "@/database/client";
import { withTenantDatabase } from "@/database/tenant";
import { PostgresBreachInvocationAuthorizationStore } from "@/providers/breach/postgres-breach-authorization-store";
import { claimBreachScanJobs } from "@/providers/breach/breach-scan-job-core";
import {
  processClaimedSyntheticBreachScan,
  type ProcessClaimedBreachScanResult,
} from "@/providers/breach/breach-scan-worker";
import { PostgresProviderUsageLedger } from "@/providers/postgres-usage-ledger";
import type { BreachProviderSelection } from "@/providers/provider-registry";
import type { AuthenticatedPrincipal } from "@/security/auth";

function accountPrincipal(account: AccountContext): AuthenticatedPrincipal {
  return { subject: account.authSubject, mode: account.authMode };
}

/**
 * Claims and processes one specific queued scan after the initiating response.
 * The durable PostgreSQL lease remains recoverable if the callback is cut
 * short; a later dispatcher can reclaim it after expiry.
 */
export async function dispatchQueuedPostgresSyntheticBreachScan(input: {
  readonly account: AccountContext;
  readonly scanId: string;
  readonly now: Date;
  readonly providerSelection: BreachProviderSelection;
}): Promise<ProcessClaimedBreachScanResult> {
  const [job] = await withRuntimeDatabase((database) =>
    claimBreachScanJobs(database, {
      now: input.now,
      batchSize: 1,
      leaseSeconds: 120,
      scanId: input.scanId,
    }),
  );
  if (!job) return "SKIPPED";

  const account: AccountContext = {
    userId: job.userId,
    identityId: job.identityId,
    authSubject: job.authSubject,
    authMode: input.account.authMode,
  };
  if (
    account.userId !== input.account.userId ||
    account.identityId !== input.account.identityId ||
    account.authSubject !== input.account.authSubject
  ) {
    throw new Error("SCAN_JOB_ACCOUNT_MISMATCH");
  }

  return withTenantDatabase(accountPrincipal(account), async (transaction) =>
    processClaimedSyntheticBreachScan({
      transaction,
      job,
      now: input.now,
      providerSelection: input.providerSelection,
      authorizationStore: new PostgresBreachInvocationAuthorizationStore(transaction),
      usageLedger: new PostgresProviderUsageLedger(transaction),
    }),
  );
}
