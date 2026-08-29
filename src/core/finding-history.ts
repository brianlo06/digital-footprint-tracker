import "server-only";

import type { AccountContext } from "@/core/account-service";
import { listFindings } from "@/core/postgres-finding-projection";
import { withTenantDatabase } from "@/database/tenant";
import type { AuthenticatedPrincipal } from "@/security/auth";

export interface TrackedFinding {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly sourceProviderId: string;
  readonly normalizedHost: string;
  readonly presenceState: "PRESENT" | "MISSING" | "UNKNOWN";
  readonly status: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date | null;
  readonly lastCheckedAt: Date;
}

function accountPrincipal(account: AccountContext): AuthenticatedPrincipal {
  return { subject: account.authSubject, mode: account.authMode };
}

export async function listTrackedFindings(
  account: AccountContext,
  options: { readonly limit: number },
): Promise<readonly TrackedFinding[]> {
  return withTenantDatabase(accountPrincipal(account), (transaction) =>
    listFindings(transaction, { userId: account.userId, limit: options.limit }),
  );
}
