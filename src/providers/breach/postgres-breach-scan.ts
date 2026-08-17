import "server-only";

import type { AccountContext } from "@/core/account-service";
import { withTenantDatabase } from "@/database/tenant";
import {
  executeSyntheticBreachScan,
  type BreachScanResult,
} from "@/providers/breach/breach-scan-service";
import { PostgresBreachInvocationAuthorizationStore } from "@/providers/breach/postgres-breach-authorization-store";
import { PostgresBreachScanRepository } from "@/providers/breach/postgres-breach-scan-repository";
import { PostgresProviderUsageLedger } from "@/providers/postgres-usage-ledger";
import type { BreachProviderSelection } from "@/providers/provider-registry";
import type { ProviderUsageBudget } from "@/providers/provider-usage-ledger";
import type { AuthenticatedPrincipal } from "@/security/auth";

type TransactionOutcome =
  | { readonly status: "RETURN"; readonly result: BreachScanResult }
  | { readonly status: "THROW"; readonly error: unknown };

function accountPrincipal(account: AccountContext): AuthenticatedPrincipal {
  return { subject: account.authSubject, mode: account.authMode };
}

/**
 * Durable wrapper for the zero-network synthetic provider only, mirroring
 * executePostgresSyntheticBreachInvocation: a thrown provider error's FAILED
 * scan/provider-run rows are committed before the error is rethrown outside
 * the transaction.
 */
export async function executePostgresSyntheticBreachScan(input: {
  readonly account: AccountContext;
  readonly now: Date;
  readonly providerSelection: BreachProviderSelection;
  readonly usageBudget?: ProviderUsageBudget;
}): Promise<BreachScanResult> {
  const outcome = await withTenantDatabase<TransactionOutcome>(
    accountPrincipal(input.account),
    async (transaction) => {
      try {
        const result = await executeSyntheticBreachScan({
          account: input.account,
          now: input.now,
          providerSelection: input.providerSelection,
          repository: new PostgresBreachScanRepository(transaction),
          authorizationStore: new PostgresBreachInvocationAuthorizationStore(transaction),
          usageLedger: new PostgresProviderUsageLedger(transaction),
          usageBudget: input.usageBudget,
        });
        return { status: "RETURN", result };
      } catch (error) {
        return { status: "THROW", error };
      }
    },
  );

  if (outcome.status === "THROW") throw outcome.error;
  return outcome.result;
}
