import "server-only";

import type { AccountContext } from "@/core/account-service";
import { listFindings } from "@/core/postgres-finding-projection";
import { withTenantDatabase } from "@/database/tenant";
import type { AuthenticatedPrincipal } from "@/security/auth";

import type { FindingStatus } from "./observation-rules";

export interface TrackedFinding {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly sourceProviderId: string;
  readonly normalizedHost: string;
  readonly presenceState: "PRESENT" | "MISSING" | "UNKNOWN";
  readonly status: FindingStatus;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date | null;
  readonly lastCheckedAt: Date;
}

function accountPrincipal(account: AccountContext): AuthenticatedPrincipal {
  return { subject: account.authSubject, mode: account.authMode };
}

export async function listTrackedFindings(
  account: AccountContext,
  options: {
    readonly limit: number;
    readonly offset?: number;
    /** Leaves out findings the user dismissed as not theirs or ignored. */
    readonly excludeDismissed?: boolean;
  },
): Promise<readonly TrackedFinding[]> {
  return withTenantDatabase(accountPrincipal(account), (transaction) =>
    listFindings(transaction, {
      userId: account.userId,
      limit: options.limit,
      offset: options.offset,
      excludeDismissed: options.excludeDismissed,
    }),
  );
}
