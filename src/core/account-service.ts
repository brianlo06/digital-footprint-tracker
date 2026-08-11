import "server-only";

import { randomUUID } from "node:crypto";
import { auditEvents, identities, users } from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { and, eq } from "drizzle-orm";

export interface AccountContext {
  readonly userId: string;
  readonly identityId: string;
  readonly authSubject: string;
  readonly authMode: AuthenticatedPrincipal["mode"];
}

export async function findAccount(
  principal: AuthenticatedPrincipal,
): Promise<AccountContext | null> {
  const account = await withTenantDatabase(principal, async (transaction) => {
    const [candidate] = await transaction
      .select({ userId: users.id, identityId: identities.id })
      .from(users)
      .innerJoin(identities, eq(identities.userId, users.id))
      .where(and(eq(users.authSubject, principal.subject), eq(users.state, "ACTIVE")))
      .limit(1);
    return candidate ?? null;
  });

  return account ? { ...account, authSubject: principal.subject, authMode: principal.mode } : null;
}

/**
 * Explicit account-initialization mutation. Call only from a user-triggered
 * server action or an equivalent authenticated command, never during render.
 */
export async function createAccountIfMissing(
  principal: AuthenticatedPrincipal,
): Promise<AccountContext> {
  const account = await withTenantDatabase(principal, async (transaction) => {
    const candidateUserId = randomUUID();
    await transaction
      .insert(users)
      .values({ id: candidateUserId, authSubject: principal.subject })
      .onConflictDoNothing({ target: users.authSubject });

    const [user] = await transaction
      .select({ id: users.id, state: users.state })
      .from(users)
      .where(eq(users.authSubject, principal.subject))
      .limit(1);
    if (!user) throw new Error("ACCOUNT_INITIALIZATION_FAILED");
    if (user.state === "DELETION_PENDING") throw new Error("ACCOUNT_DELETION_PENDING");

    const candidateIdentityId = randomUUID();
    const [createdIdentity] = await transaction
      .insert(identities)
      .values({ id: candidateIdentityId, userId: user.id })
      .onConflictDoNothing({ target: identities.userId })
      .returning({ id: identities.id });

    const [identity] = createdIdentity
      ? [createdIdentity]
      : await transaction
          .select({ id: identities.id })
          .from(identities)
          .where(eq(identities.userId, user.id))
          .limit(1);
    if (!identity) throw new Error("IDENTITY_INITIALIZATION_FAILED");

    if (createdIdentity) {
      await transaction.insert(auditEvents).values({
        userId: user.id,
        actorType: "USER",
        action: "ACCOUNT_CREATED",
        targetType: "USER",
        targetId: user.id,
        outcome: "SUCCESS",
        correlationId: randomUUID(),
      });
    }

    return { userId: user.id, identityId: identity.id };
  });

  return {
    ...account,
    authSubject: principal.subject,
    authMode: principal.mode,
  };
}
