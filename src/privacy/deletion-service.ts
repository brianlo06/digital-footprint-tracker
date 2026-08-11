import "server-only";

import { randomUUID } from "node:crypto";
import { auditEvents, deletionReceipts, users } from "@/database/schema";
import { deletionSubjectToken, withTenantDatabase } from "@/database/tenant";
import type { AuthGateway, AuthenticatedPrincipal } from "@/security/auth";
import { eq } from "drizzle-orm";

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
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const effectiveReceiptId = await withTenantDatabase(principal, async (transaction) => {
    const [receipt] = await transaction
      .insert(deletionReceipts)
      .values({ id: receiptId, subjectToken, state: "REQUESTED", expiresAt })
      .onConflictDoUpdate({
        target: deletionReceipts.subjectToken,
        set: { state: "REQUESTED", failureCode: null },
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

  await withTenantDatabase(principal, async (transaction) => {
    await transaction
      .update(auditEvents)
      .set({ targetId: null })
      .where(eq(auditEvents.userId, user.id));
    await transaction.delete(users).where(eq(users.id, user.id));
    await transaction
      .update(deletionReceipts)
      .set({ state: "COMPLETED", completedAt: new Date(), failureCode: null })
      .where(eq(deletionReceipts.subjectToken, subjectToken));
  });

  return { receiptId: effectiveReceiptId };
}
