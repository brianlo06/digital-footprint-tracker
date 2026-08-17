import "server-only";

import type { AccountContext } from "@/core/account-service";
import type { DatabaseTransaction } from "@/database/client";
import {
  breachFindings,
  consentRecords,
  identifiers,
  identities,
  providerRuns,
  scans,
  users,
} from "@/database/schema";
import {
  BREACH_CONSENT_POLICY_VERSION,
  BREACH_CONSENT_PURPOSE,
} from "@/providers/breach/breach-invocation-policy";
import {
  ScanAlreadyRunningError,
  type EligibleBreachTarget,
  type ScanRunRepository,
} from "@/providers/breach/breach-scan-service";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * Tenant-scoped Drizzle implementation of ScanRunRepository. The supplied
 * transaction must come from withTenantDatabase so PostgreSQL RLS
 * independently enforces ownership on every statement below.
 */
export class PostgresBreachScanRepository implements ScanRunRepository {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async findEligibleTarget(account: AccountContext): Promise<EligibleBreachTarget | null> {
    const [row] = await this.transaction
      .select({ identifierId: identifiers.id, consentRecordId: consentRecords.id })
      .from(identifiers)
      .innerJoin(identities, eq(identities.id, identifiers.identityId))
      .innerJoin(users, eq(users.id, identities.userId))
      .innerJoin(
        consentRecords,
        and(eq(consentRecords.userId, users.id), eq(consentRecords.identityId, identities.id)),
      )
      .where(
        and(
          eq(users.id, account.userId),
          eq(identities.id, account.identityId),
          eq(identifiers.type, "EMAIL"),
          eq(identifiers.verificationStatus, "VERIFIED"),
          eq(consentRecords.purpose, BREACH_CONSENT_PURPOSE),
          eq(consentRecords.policyVersion, BREACH_CONSENT_POLICY_VERSION),
          eq(consentRecords.state, "GRANTED"),
          sql`${consentRecords.withdrawnAt} is null`,
        ),
      )
      .orderBy(desc(identifiers.lastVerifiedAt))
      .limit(1);
    return row ?? null;
  }

  async createScan(input: {
    readonly userId: string;
    readonly identityId: string;
    readonly requestedCapability: string;
  }): Promise<string> {
    try {
      // A savepoint isolates the unique-violation this racing insert can
      // legitimately hit: without it, PostgreSQL aborts the whole enclosing
      // transaction on any statement error, and a plain catch here could not
      // let the caller continue in the same transaction.
      const created = await this.transaction.transaction(async (nested) => {
        const [row] = await nested
          .insert(scans)
          .values({
            userId: input.userId,
            identityId: input.identityId,
            trigger: "USER",
            state: "RUNNING",
            requestedCapability: input.requestedCapability,
          })
          .returning({ id: scans.id });
        return row;
      });
      if (!created) throw new Error("SCAN_CREATE_FAILED");
      return created.id;
    } catch (error) {
      const typed = error as { code?: string; cause?: { code?: string } } | undefined;
      const code = typed?.code ?? typed?.cause?.code;
      if (code === "23505") throw new ScanAlreadyRunningError();
      throw error;
    }
  }

  async createProviderRun(input: {
    readonly scanId: string;
    readonly userId: string;
    readonly providerId: string;
    readonly capability: string;
  }): Promise<string> {
    const [created] = await this.transaction
      .insert(providerRuns)
      .values({
        scanId: input.scanId,
        userId: input.userId,
        providerId: input.providerId,
        capability: input.capability,
        state: "RUNNING",
      })
      .returning({ id: providerRuns.id });
    if (!created) throw new Error("PROVIDER_RUN_CREATE_FAILED");
    return created.id;
  }

  async completeProviderRun(
    input: Parameters<ScanRunRepository["completeProviderRun"]>[0],
  ): Promise<void> {
    if (input.outcome === "COMPLETED") {
      await this.transaction
        .update(providerRuns)
        .set({
          state: "COMPLETED",
          resultCount: input.resultCount,
          healthOutcome: input.healthOutcome,
          reservationId: input.reservationId,
          finishedAt: sql`now()`,
        })
        .where(eq(providerRuns.id, input.providerRunId));
      return;
    }

    await this.transaction
      .update(providerRuns)
      .set({
        state: "FAILED",
        errorSafeCode: input.errorSafeCode,
        reservationId: input.reservationId,
        finishedAt: sql`now()`,
      })
      .where(eq(providerRuns.id, input.providerRunId));
  }

  async completeScan(input: {
    readonly scanId: string;
    readonly outcome: "COMPLETED" | "FAILED";
  }): Promise<void> {
    await this.transaction
      .update(scans)
      .set({ state: input.outcome, completedAt: sql`now()` })
      .where(eq(scans.id, input.scanId));
  }

  async insertBreachFindings(
    input: Parameters<ScanRunRepository["insertBreachFindings"]>[0],
  ): Promise<void> {
    if (input.candidates.length === 0) return;
    const rows = input.candidates.map((candidate) => {
      const evidence = candidate.evidence[0];
      if (
        !evidence ||
        !evidence.providerExternalId ||
        !evidence.sourceUrl ||
        !evidence.sourceDate ||
        !evidence.providerFirstSeenAt ||
        !evidence.providerLastSeenAt ||
        !evidence.dataCategories ||
        evidence.dataCategories.length === 0 ||
        evidence.isVerified === undefined ||
        evidence.isSensitive === undefined ||
        evidence.isRetired === undefined
      ) {
        throw new Error("BREACH_FINDING_EVIDENCE_INCOMPLETE");
      }
      return {
        providerRunId: input.providerRunId,
        userId: input.userId,
        identityId: input.identityId,
        providerBreachId: evidence.providerExternalId,
        breachName: candidate.title,
        breachDate: evidence.sourceDate,
        providerAddedAt: new Date(evidence.providerFirstSeenAt),
        providerModifiedAt: new Date(evidence.providerLastSeenAt),
        dataCategories: [...evidence.dataCategories],
        isVerified: evidence.isVerified,
        isSensitive: evidence.isSensitive,
        isRetired: evidence.isRetired,
        sourceUrl: evidence.sourceUrl,
        checkedAt: input.checkedAt,
        parserVersion: input.parserVersion,
      };
    });
    await this.transaction.insert(breachFindings).values(rows);
  }
}
