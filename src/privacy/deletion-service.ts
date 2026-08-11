import "server-only";

import { randomUUID } from "node:crypto";
import { auditEvents, deletionReceipts, users } from "@/database/schema";
import { deletionSubjectToken, withTenantDatabase } from "@/database/tenant";
import type { AuthGateway, AuthenticatedPrincipal } from "@/security/auth";
import { eq } from "drizzle-orm";

const DELETION_RECEIPT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

async function finalizeLocalDeletion(
  principal: AuthenticatedPrincipal,
  userId: string,
  subjectToken: string,
): Promise<void> {
  await withTenantDatabase(principal, async (transaction) => {
    await transaction
      .update(auditEvents)
      .set({ targetId: null })
      .where(eq(auditEvents.userId, userId));
    await transaction.delete(users).where(eq(users.id, userId));
    await transaction
      .update(deletionReceipts)
      .set({ state: "COMPLETED", completedAt: new Date(), failureCode: null })
      .where(eq(deletionReceipts.subjectToken, subjectToken));
  });
}

export async function deleteAccount(
  principal: AuthenticatedPrincipal,
  authGateway: AuthGateway,
  authorization: { readonly recentlyReauthenticated: boolean },
): Promise<{ receiptId: string }> {
  if (!authorization.recentlyReauthenticated) {
    throw new Error("RECENT_REAUTHENTICATION_REQUIRED");
  }

  const user = await withTenantDatabase(principal, async (transaction) => {
    const [candidate] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.authSubject, principal.subject))
      .limit(1);
    return candidate ?? null;
  });

  if (!user) throw new Error("ACCOUNT_NOT_FOUND");

  const receiptId = randomUUID();
  const correlationId = randomUUID();
  const subjectToken = deletionSubjectToken(principal.subject);
  const expiresAt = new Date(Date.now() + DELETION_RECEIPT_TTL_MS);

  const effectiveReceiptId = await withTenantDatabase(principal, async (transaction) => {
    const [receipt] = await transaction
      .insert(deletionReceipts)
      .values({ id: receiptId, subjectToken, state: "REQUESTED", expiresAt })
      .onConflictDoUpdate({
        target: deletionReceipts.subjectToken,
        set: { state: "REQUESTED", completedAt: null, failureCode: null },
      })
      .returning({ id: deletionReceipts.id });
    await transaction
      .update(users)
      .set({ state: "DELETION_PENDING", deletionRequestedAt: new Date() })
      .where(eq(users.id, user.id));
    await transaction.insert(auditEvents).values({
      userId: user.id,
      actorType: "USER",
      action: "ACCOUNT_DELETION_REQUESTED",
      targetType: "USER",
      targetId: user.id,
      outcome: "SUCCESS",
      correlationId,
    });
    return receipt.id;
  });

  try {
    await authGateway.deletePrincipal(principal.subject);
    await withTenantDatabase(principal, async (transaction) => {
      await transaction
        .update(deletionReceipts)
        .set({ state: "AUTH_REVOKED" })
        .where(eq(deletionReceipts.subjectToken, subjectToken));
    });
  } catch {
    await withTenantDatabase(principal, async (transaction) => {
      await transaction
        .update(deletionReceipts)
        .set({ state: "FAILED", failureCode: "AUTH_PROVIDER_DELETE_FAILED" })
        .where(eq(deletionReceipts.subjectToken, subjectToken));
    });
    throw new Error("ACCOUNT_DELETION_RETRY_REQUIRED");
  }

  await finalizeLocalDeletion(principal, user.id, subjectToken);

  return { receiptId: effectiveReceiptId };
}

/**
 * Finishes local deletion after the identity provider has confirmed that the
 * Clerk user no longer exists. This is intentionally idempotent: Clerk can
 * retry webhook deliveries, and a webhook can race the user-facing deletion
 * action after the provider deletion has already succeeded.
 */
export async function resumeAccountDeletionAfterAuthRevoked(
  authSubject: string,
): Promise<{ receiptId: string | null }> {
  const principal: AuthenticatedPrincipal = { subject: authSubject, mode: "clerk" };
  const subjectToken = deletionSubjectToken(authSubject);
  const receiptId = randomUUID();
  const correlationId = randomUUID();
  const expiresAt = new Date(Date.now() + DELETION_RECEIPT_TTL_MS);

  const recovery = await withTenantDatabase(principal, async (transaction) => {
    const [user] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.authSubject, authSubject))
      .limit(1)
      .for("update");

    if (!user) {
      const [receipt] = await transaction
        .select({ id: deletionReceipts.id })
        .from(deletionReceipts)
        .where(eq(deletionReceipts.subjectToken, subjectToken))
        .limit(1);
      return receipt ? { receiptId: receipt.id, userId: null } : null;
    }

    const [receipt] = await transaction
      .insert(deletionReceipts)
      .values({
        id: receiptId,
        subjectToken,
        state: "AUTH_REVOKED",
        expiresAt,
      })
      .onConflictDoUpdate({
        target: deletionReceipts.subjectToken,
        set: { state: "AUTH_REVOKED", completedAt: null, failureCode: null },
      })
      .returning({ id: deletionReceipts.id });

    await transaction
      .update(users)
      .set({ state: "DELETION_PENDING", deletionRequestedAt: new Date() })
      .where(eq(users.id, user.id));
    await transaction.insert(auditEvents).values({
      userId: user.id,
      actorType: "SYSTEM",
      action: "AUTH_PROVIDER_ACCOUNT_DELETED",
      targetType: "USER",
      targetId: user.id,
      outcome: "SUCCESS",
      correlationId,
    });

    return { receiptId: receipt.id, userId: user.id };
  });

  if (!recovery) return { receiptId: null };
  if (recovery.userId) {
    await finalizeLocalDeletion(principal, recovery.userId, subjectToken);
  }

  return { receiptId: recovery.receiptId };
}
