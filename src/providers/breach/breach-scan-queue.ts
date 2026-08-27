import "server-only";

import type { AccountContext } from "@/core/account-service";
import { scans, scanJobs } from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import {
  BREACH_SCAN_REQUESTED_CAPABILITY,
  ScanAlreadyRunningError,
} from "@/providers/breach/breach-scan-service";
import { PostgresBreachScanRepository } from "@/providers/breach/postgres-breach-scan-repository";
import type { BreachProviderSelection } from "@/providers/provider-registry";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

export type EnqueueBreachScanResult =
  | { readonly status: "PROVIDER_DISABLED" }
  | { readonly status: "NO_ELIGIBLE_TARGET" }
  | { readonly status: "ALREADY_RUNNING"; readonly scanId: string }
  | { readonly status: "QUEUED"; readonly scanId: string };

const scanIdSchema = z.uuid();

function accountPrincipal(account: AccountContext): AuthenticatedPrincipal {
  return { subject: account.authSubject, mode: account.authMode };
}

/**
 * Atomically creates a QUEUED scan and its opaque PostgreSQL job. No provider
 * work occurs in the web request, and the job contains identifiers only by
 * UUID reference—never the decrypted email value.
 */
export async function enqueuePostgresSyntheticBreachScan(input: {
  readonly account: AccountContext;
  readonly providerSelection: BreachProviderSelection;
}): Promise<EnqueueBreachScanResult> {
  if (input.providerSelection.status !== "ENABLED_SYNTHETIC" || !input.providerSelection.provider) {
    return { status: "PROVIDER_DISABLED" };
  }

  return withTenantDatabase(accountPrincipal(input.account), async (transaction) => {
    const repository = new PostgresBreachScanRepository(transaction);
    const target = await repository.findEligibleTarget(input.account);
    if (!target) return { status: "NO_ELIGIBLE_TARGET" };

    try {
      const scanId = await transaction.transaction(async (nested) => {
        const [created] = await nested
          .insert(scans)
          .values({
            userId: input.account.userId,
            identityId: input.account.identityId,
            trigger: "USER",
            state: "QUEUED",
            requestedCapability: BREACH_SCAN_REQUESTED_CAPABILITY,
          })
          .returning({ id: scans.id });
        if (!created) throw new Error("SCAN_CREATE_FAILED");

        await nested.insert(scanJobs).values({
          scanId: created.id,
          userId: input.account.userId,
          identityId: input.account.identityId,
          identifierId: target.identifierId,
          consentRecordId: target.consentRecordId,
        });
        return created.id;
      });
      return { status: "QUEUED", scanId };
    } catch (error) {
      const typed = error as { code?: string; cause?: { code?: string } } | undefined;
      const code = typed?.code ?? typed?.cause?.code;
      if (code === "23505" || error instanceof ScanAlreadyRunningError) {
        const [active] = await transaction
          .select({ scanId: scans.id })
          .from(scans)
          .where(
            and(
              eq(scans.userId, input.account.userId),
              eq(scans.requestedCapability, BREACH_SCAN_REQUESTED_CAPABILITY),
              inArray(scans.state, ["QUEUED", "RUNNING"]),
            ),
          )
          .limit(1);
        if (!active) throw error;
        return { status: "ALREADY_RUNNING", scanId: active.scanId };
      }
      throw error;
    }
  });
}

export type CancelQueuedBreachScanResult = "CANCELLED" | "NOT_CANCELLABLE";

/** Cancels only work that has not been claimed; RUNNING work is never
 * represented to the user as safely interrupted after provider dispatch. */
export async function cancelQueuedPostgresBreachScan(
  account: AccountContext,
  untrustedScanId: string,
): Promise<CancelQueuedBreachScanResult> {
  const scanId = scanIdSchema.parse(untrustedScanId);
  return withTenantDatabase(accountPrincipal(account), async (transaction) => {
    const [cancelledJob] = await transaction
      .update(scanJobs)
      .set({
        state: "CANCELLED",
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(scanJobs.scanId, scanId),
          eq(scanJobs.userId, account.userId),
          inArray(scanJobs.state, ["PENDING"]),
        ),
      )
      .returning({ scanId: scanJobs.scanId });
    if (!cancelledJob) return "NOT_CANCELLABLE";

    const [cancelledScan] = await transaction
      .update(scans)
      .set({ state: "CANCELLED", completedAt: sql`now()` })
      .where(and(eq(scans.id, scanId), eq(scans.userId, account.userId), eq(scans.state, "QUEUED")))
      .returning({ id: scans.id });
    if (!cancelledScan) throw new Error("SCAN_CANCEL_STATE_MISMATCH");
    return "CANCELLED";
  });
}
