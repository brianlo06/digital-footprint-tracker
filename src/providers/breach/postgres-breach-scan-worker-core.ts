import type { Database } from "@/database/client";
import { PostgresBreachInvocationAuthorizationStore } from "@/providers/breach/postgres-breach-authorization-store";
import type { ClaimedBreachScanJob } from "@/providers/breach/breach-scan-job-core";
import {
  processClaimedSyntheticBreachScan,
  type ProcessClaimedBreachScanResult,
} from "@/providers/breach/breach-scan-worker";
import { PostgresProviderUsageLedger } from "@/providers/postgres-usage-ledger";
import type { BreachProviderSelection } from "@/providers/provider-registry";
import { sql } from "drizzle-orm";

/** Restores one claim's tenant context on a transaction-local basis before
 * any authorization, quota, provider, or persistence operation runs. */
export async function processClaimedPostgresSyntheticBreachScan(input: {
  readonly database: Database;
  readonly job: ClaimedBreachScanJob;
  readonly now: Date;
  readonly providerSelection: BreachProviderSelection;
}): Promise<ProcessClaimedBreachScanResult> {
  return input.database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.auth_subject', ${input.job.authSubject}, true)`,
    );
    return processClaimedSyntheticBreachScan({
      transaction,
      job: input.job,
      now: input.now,
      providerSelection: input.providerSelection,
      authorizationStore: new PostgresBreachInvocationAuthorizationStore(transaction),
      usageLedger: new PostgresProviderUsageLedger(transaction),
    });
  });
}
