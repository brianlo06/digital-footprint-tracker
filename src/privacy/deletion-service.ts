import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseTransaction } from "@/database/client";
import { auditEvents, deletionReceipts, users } from "@/database/schema";
import { deletionSubjectTokens, withTenantDatabase, type SubjectTokens } from "@/database/tenant";
import type { AuthGateway, AuthenticatedPrincipal } from "@/security/auth";
import { and, eq, inArray, or } from "drizzle-orm";

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

/**
 * Migrates a still-pending receipt created under the previous lookup key to
 * the current key before any new write, so at most one receipt per subject
 * ever exists across a lookup-key rotation. Completed receipts are never
 * touched here; they age out under their original key (ADR 0016).
 */
async function migrateReceiptToCurrentKey(
  transaction: DatabaseTransaction,
  tokens: SubjectTokens,
): Promise<void> {
  if (!tokens.previous) return;
  await transaction
    .update(deletionReceipts)
    .set({ subjectToken: tokens.current.token, subjectTokenKeyId: tokens.current.keyId })
    .where(
      and(
        eq(deletionReceipts.subjectToken, tokens.previous.token),
        inArray(deletionReceipts.state, ["REQUESTED", "AUTH_REVOKED", "FAILED"]),
      ),
    );
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
  const tokens = deletionSubjectTokens(principal.subject);
  const expiresAt = new Date(Date.now() + DELETION_RECEIPT_TTL_MS);

  const effectiveReceiptId = await withTenantDatabase(principal, async (transaction) => {
    // Lock the user row inside the same transaction as the migrate-in-place
    // step and the receipt upsert, so a concurrent duplicate deletion request
    // for this subject cannot race the token migration.
    const [lockedUser] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
      .for("update");
    if (!lockedUser) throw new Error("ACCOUNT_NOT_FOUND");

    await migrateReceiptToCurrentKey(transaction, tokens);

    const [receipt] = await transaction
      .insert(deletionReceipts)
      .values({
        id: receiptId,
        subjectToken: tokens.current.token,
        subjectTokenKeyId: tokens.current.keyId,
        state: "REQUESTED",
        expiresAt,
      })
      .onConflictDoUpdate({
        target: deletionReceipts.subjectToken,
        set: {
          state: "REQUESTED",
          subjectTokenKeyId: tokens.current.keyId,
          completedAt: null,
          failureCode: null,
        },
      })
      .returning({ id: deletionReceipts.id });
    await transaction
      .update(users)
      .set({ state: "DELETION_PENDING", deletionRequestedAt: new Date() })
      .where(eq(users.id, lockedUser.id));
    await transaction.insert(auditEvents).values({
      userId: lockedUser.id,
      actorType: "USER",
      action: "ACCOUNT_DELETION_REQUESTED",
      targetType: "USER",
      targetId: lockedUser.id,
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
        .where(eq(deletionReceipts.subjectToken, tokens.current.token));
    });
  } catch {
    await withTenantDatabase(principal, async (transaction) => {
      await transaction
        .update(deletionReceipts)
        .set({ state: "FAILED", failureCode: "AUTH_PROVIDER_DELETE_FAILED" })
        .where(eq(deletionReceipts.subjectToken, tokens.current.token));
    });
    throw new Error("ACCOUNT_DELETION_RETRY_REQUIRED");
  }

  await finalizeLocalDeletion(principal, user.id, tokens.current.token);

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
  const tokens = deletionSubjectTokens(authSubject);
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
      // No local user row: either deletion already completed, or this is a
      // duplicate webhook for a subject that never had one. Read-only lookup
      // across both keys keeps replay idempotent without reconstructing or
      // extending retention on a completed receipt.
      const [receipt] = await transaction
        .select({ id: deletionReceipts.id })
        .from(deletionReceipts)
        .where(
          or(
            eq(deletionReceipts.subjectToken, tokens.current.token),
            tokens.previous ? eq(deletionReceipts.subjectToken, tokens.previous.token) : undefined,
          ),
        )
        .limit(1);
      return receipt ? { receiptId: receipt.id, userId: null } : null;
    }

    await migrateReceiptToCurrentKey(transaction, tokens);

    const [receipt] = await transaction
      .insert(deletionReceipts)
      .values({
        id: receiptId,
        subjectToken: tokens.current.token,
        subjectTokenKeyId: tokens.current.keyId,
        state: "AUTH_REVOKED",
        expiresAt,
      })
      .onConflictDoUpdate({
        target: deletionReceipts.subjectToken,
        set: {
          state: "AUTH_REVOKED",
          subjectTokenKeyId: tokens.current.keyId,
          completedAt: null,
          failureCode: null,
        },
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
    await finalizeLocalDeletion(principal, recovery.userId, tokens.current.token);
  }

  return { receiptId: recovery.receiptId };
}
