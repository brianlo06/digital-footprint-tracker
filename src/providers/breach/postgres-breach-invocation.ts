import "server-only";

import { withTenantDatabase } from "@/database/tenant";
import {
  executeSyntheticBreachInvocation,
  type SyntheticBreachInvocationCommand,
  type SyntheticBreachInvocationResult,
} from "@/providers/breach/breach-invocation-service";
import { PostgresBreachInvocationAuthorizationStore } from "@/providers/breach/postgres-breach-authorization-store";
import { PostgresProviderUsageLedger } from "@/providers/postgres-usage-ledger";
import type { BreachProviderSelection } from "@/providers/provider-registry";
import type { ProviderUsageBudget } from "@/providers/provider-usage-ledger";
import type { AuthenticatedPrincipal } from "@/security/auth";

type TransactionOutcome =
  | { readonly status: "RETURN"; readonly result: SyntheticBreachInvocationResult }
  | { readonly status: "THROW"; readonly error: unknown };

/**
 * Durable wrapper for the zero-network synthetic provider only. Catching the
 * provider error inside the transaction commits its FAILED usage record, then
 * rethrows after commit. A live network adapter must use a short-transaction
 * job state machine instead of holding a database transaction across I/O.
 */
export async function executePostgresSyntheticBreachInvocation(input: {
  readonly principal: AuthenticatedPrincipal;
  readonly command: SyntheticBreachInvocationCommand;
  readonly now: Date;
  readonly providerSelection: BreachProviderSelection;
  readonly usageBudget?: ProviderUsageBudget;
}): Promise<SyntheticBreachInvocationResult> {
  const outcome = await withTenantDatabase<TransactionOutcome>(
    input.principal,
    async (transaction) => {
      try {
        const result = await executeSyntheticBreachInvocation({
          command: input.command,
          now: input.now,
          providerSelection: input.providerSelection,
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
