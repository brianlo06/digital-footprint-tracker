import "server-only";

import { randomUUID } from "node:crypto";
import type { AccountContext } from "@/core/account-service";
import { auditEvents, findings, identifiers, observations } from "@/database/schema";
import { withTenantDatabase } from "@/database/tenant";
import type { AuthenticatedPrincipal } from "@/security/auth";
import { and, desc, eq } from "drizzle-orm";

import { statusAfterReview, type FindingReviewDecision } from "./finding-review";
import type { FindingPresenceState, FindingStatus, ObservationPresence } from "./observation-rules";

const OBSERVATION_DISPLAY_LIMIT = 50;

export interface FindingObservationEntry {
  readonly id: string;
  readonly presence: ObservationPresence;
  readonly observedAt: Date;
  readonly sourceDate: string | null;
  readonly parserVersion: string;
  /** True when the provider's stable content differs from the prior observation. */
  readonly contentChanged: boolean;
}

export interface FindingDetail {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly sourceProviderId: string;
  readonly normalizedHost: string;
  readonly presenceState: FindingPresenceState;
  readonly status: FindingStatus;
  readonly consecutiveAbsences: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date | null;
  readonly lastCheckedAt: Date;
  /** Masked only; null once the matched identifier has been removed. */
  readonly matchedIdentifierMasked: string | null;
  /** Newest first, capped for display. */
  readonly observations: readonly FindingObservationEntry[];
  readonly observationsTruncated: boolean;
}

function accountPrincipal(account: AccountContext): AuthenticatedPrincipal {
  return { subject: account.authSubject, mode: account.authMode };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isFindingId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export async function getFindingDetail(
  account: AccountContext,
  findingId: string,
): Promise<FindingDetail | null> {
  if (!isFindingId(findingId)) return null;
  return withTenantDatabase(accountPrincipal(account), async (transaction) => {
    const [finding] = await transaction
      .select({
        id: findings.id,
        type: findings.type,
        title: findings.title,
        sourceProviderId: findings.sourceProviderId,
        normalizedHost: findings.normalizedHost,
        presenceState: findings.presenceState,
        status: findings.status,
        consecutiveAbsences: findings.consecutiveAbsences,
        firstSeenAt: findings.firstSeenAt,
        lastSeenAt: findings.lastSeenAt,
        lastCheckedAt: findings.lastCheckedAt,
        matchedIdentifierMasked: identifiers.maskedDisplay,
      })
      .from(findings)
      .leftJoin(identifiers, eq(identifiers.id, findings.matchedIdentifierId))
      .where(and(eq(findings.id, findingId), eq(findings.userId, account.userId)))
      .limit(1);
    if (!finding) return null;

    // One extra row tells the page whether older history exists, and gives
    // the oldest displayed entry a predecessor to compare its content with.
    const rows = await transaction
      .select({
        id: observations.id,
        presence: observations.presence,
        observedAt: observations.observedAt,
        sourceDate: observations.sourceDate,
        parserVersion: observations.parserVersion,
        contentFingerprint: observations.contentFingerprint,
      })
      .from(observations)
      .where(and(eq(observations.findingId, finding.id), eq(observations.userId, account.userId)))
      .orderBy(desc(observations.observedAt), desc(observations.id))
      .limit(OBSERVATION_DISPLAY_LIMIT + 1);

    // An absent or indeterminate observation carries no provider content, so
    // only two consecutive PRESENT observations can show a content change.
    const presentRows = rows.filter((row) => row.presence === "PRESENT");
    const priorPresentFingerprint = new Map<string, string>();
    presentRows.forEach((row, index) => {
      const older = presentRows[index + 1];
      if (older) priorPresentFingerprint.set(row.id, older.contentFingerprint);
    });

    return {
      ...finding,
      observations: rows.slice(0, OBSERVATION_DISPLAY_LIMIT).map((row) => {
        const prior = priorPresentFingerprint.get(row.id);
        return {
          id: row.id,
          presence: row.presence,
          observedAt: row.observedAt,
          sourceDate: row.sourceDate,
          parserVersion: row.parserVersion,
          contentChanged: prior !== undefined && prior !== row.contentFingerprint,
        };
      }),
      observationsTruncated: rows.length > OBSERVATION_DISPLAY_LIMIT,
    };
  });
}

export type FindingReviewOutcome =
  | { readonly outcome: "UPDATED"; readonly status: FindingStatus }
  | { readonly outcome: "UNCHANGED" }
  | { readonly outcome: "NOT_FOUND" };

/**
 * Records the account holder's decision about one of their own findings. The
 * row is locked so a concurrent scan projection cannot interleave between
 * reading the temporal state and writing the status derived from it.
 */
export async function reviewFinding(
  account: AccountContext,
  findingId: string,
  decision: FindingReviewDecision,
): Promise<FindingReviewOutcome> {
  if (!isFindingId(findingId)) return { outcome: "NOT_FOUND" };
  return withTenantDatabase(accountPrincipal(account), async (transaction) => {
    const [current] = await transaction
      .select({
        presenceState: findings.presenceState,
        status: findings.status,
        consecutiveAbsences: findings.consecutiveAbsences,
      })
      .from(findings)
      .where(and(eq(findings.id, findingId), eq(findings.userId, account.userId)))
      .limit(1)
      .for("update");
    if (!current) return { outcome: "NOT_FOUND" } as const;

    const next = statusAfterReview(current, decision);
    if (next === null) return { outcome: "UNCHANGED" } as const;

    await transaction
      .update(findings)
      .set({ status: next, updatedAt: new Date() })
      .where(and(eq(findings.id, findingId), eq(findings.userId, account.userId)));
    await transaction.insert(auditEvents).values({
      userId: account.userId,
      actorType: "USER",
      action: `FINDING_REVIEW_${decision}`,
      targetType: "FINDING",
      targetId: findingId,
      outcome: "SUCCESS",
      correlationId: randomUUID(),
    });
    return { outcome: "UPDATED", status: next } as const;
  });
}
