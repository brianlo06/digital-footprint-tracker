import "server-only";

import type { DatabaseTransaction } from "@/database/client";
import { consentRecords, identifiers, identities, users } from "@/database/schema";
import type { BreachInvocationAuthorizationSnapshot } from "@/providers/breach/breach-invocation-policy";
import type {
  BreachInvocationAuthorizationStore,
  SyntheticBreachInvocationCommand,
} from "@/providers/breach/breach-invocation-service";
import { and, eq } from "drizzle-orm";

/**
 * Tenant-scoped authorization snapshot. The supplied transaction must come
 * from withTenantDatabase so PostgreSQL RLS independently enforces ownership.
 */
export class PostgresBreachInvocationAuthorizationStore implements BreachInvocationAuthorizationStore {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async load(
    command: SyntheticBreachInvocationCommand,
  ): Promise<BreachInvocationAuthorizationSnapshot | null> {
    const [row] = await this.transaction
      .select({
        accountUserId: users.id,
        accountState: users.state,
        identityId: identities.id,
        identityUserId: identities.userId,
        identityState: identities.state,
        identifierId: identifiers.id,
        identifierIdentityId: identifiers.identityId,
        identifierType: identifiers.type,
        verificationStatus: identifiers.verificationStatus,
        lastVerifiedAt: identifiers.lastVerifiedAt,
        consentRecordId: consentRecords.id,
        consentUserId: consentRecords.userId,
        consentIdentityId: consentRecords.identityId,
        consentPurpose: consentRecords.purpose,
        consentPolicyVersion: consentRecords.policyVersion,
        consentState: consentRecords.state,
        consentDataCategories: consentRecords.dataCategories,
        consentGrantedAt: consentRecords.grantedAt,
        consentWithdrawnAt: consentRecords.withdrawnAt,
      })
      .from(users)
      .innerJoin(identities, eq(identities.userId, users.id))
      .innerJoin(identifiers, eq(identifiers.identityId, identities.id))
      .innerJoin(
        consentRecords,
        and(eq(consentRecords.userId, users.id), eq(consentRecords.identityId, identities.id)),
      )
      .where(
        and(
          eq(users.id, command.userId),
          eq(identities.id, command.identityId),
          eq(identifiers.id, command.identifierId),
          eq(consentRecords.id, command.consentRecordId),
        ),
      )
      .limit(1)
      .for("share");

    if (!row || row.identifierType !== "EMAIL") return null;
    return {
      account: { userId: row.accountUserId, state: row.accountState },
      identity: {
        identityId: row.identityId,
        userId: row.identityUserId,
        state: row.identityState,
      },
      identifier: {
        identifierId: row.identifierId,
        identityId: row.identifierIdentityId,
        type: row.identifierType,
        verificationStatus: row.verificationStatus,
        lastVerifiedAt: row.lastVerifiedAt,
      },
      consent: {
        consentRecordId: row.consentRecordId,
        userId: row.consentUserId,
        identityId: row.consentIdentityId,
        purpose: row.consentPurpose,
        policyVersion: row.consentPolicyVersion,
        state: row.consentState,
        dataCategories: row.consentDataCategories,
        grantedAt: row.consentGrantedAt,
        withdrawnAt: row.consentWithdrawnAt,
      },
    };
  }
}
