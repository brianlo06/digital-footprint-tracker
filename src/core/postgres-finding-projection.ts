import "server-only";

import type { DatabaseTransaction } from "@/database/client";
import { findings, identifiers, observations } from "@/database/schema";
import {
  computeContentFingerprint,
  computeFindingFingerprint,
  FINDING_FINGERPRINT_VERSION,
} from "@/core/finding-fingerprint";
import {
  applyObservation,
  INITIAL_FINDING_STATE,
  presenceForScanResult,
  type FindingTemporalState,
  type ObservationPresence,
} from "@/core/observation-rules";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

/** One provider-reported resource, already normalized past the adapter boundary. */
export interface ProjectedCandidate {
  readonly findingType: "BREACH";
  readonly title: string;
  readonly normalizedHost: string;
  readonly providerExternalId: string;
  readonly sourceDate: string | null;
  /** Stable content fields; a change here changes the content fingerprint. */
  readonly contentFields: readonly string[];
}

export interface FindingProjectionInput {
  readonly userId: string;
  readonly identityId: string;
  readonly matchedIdentifierId: string;
  readonly providerRunId: string;
  readonly providerId: string;
  readonly scanOutcome: "COMPLETED" | "PARTIAL" | "FAILED";
  readonly observedAt: Date;
  readonly parserVersion: string;
  readonly candidates: readonly ProjectedCandidate[];
}

export interface FindingProjectionResult {
  readonly present: number;
  readonly missing: number;
  readonly indeterminate: number;
}

/**
 * Projects one provider run's results onto the generic temporal model:
 * every reported resource becomes a PRESENT observation, and every finding
 * this provider previously reported but did not report now becomes MISSING
 * or INDETERMINATE according to ADR 0006's rules.
 *
 * The caller must supply a transaction already inside the tenant's RLS
 * context; RLS remains an independent boundary on every statement here.
 */
export async function projectFindingObservations(
  transaction: DatabaseTransaction,
  input: FindingProjectionInput,
): Promise<FindingProjectionResult> {
  const [identifier] = await transaction
    .select({ lookupToken: identifiers.lookupToken })
    .from(identifiers)
    .where(eq(identifiers.id, input.matchedIdentifierId));
  if (!identifier) throw new Error("FINDING_PROJECTION_IDENTIFIER_MISSING");

  const observed = input.candidates.map((candidate) => ({
    candidate,
    fingerprint: computeFindingFingerprint({
      findingType: candidate.findingType,
      providerScope: input.providerId,
      normalizedHost: candidate.normalizedHost,
      identifierLookupToken: identifier.lookupToken,
      normalizedResourceId: candidate.providerExternalId,
    }),
  }));

  // Lock every finding this provider has ever reported for this tenant, not
  // just the ones in this result set: absence is what makes a finding
  // missing, so those rows are exactly the ones this run may transition.
  const existing = await transaction
    .select({
      id: findings.id,
      fingerprint: findings.fingerprint,
      presenceState: findings.presenceState,
      status: findings.status,
      consecutiveAbsences: findings.consecutiveAbsences,
      firstSeenAt: findings.firstSeenAt,
    })
    .from(findings)
    .where(
      and(
        eq(findings.userId, input.userId),
        eq(findings.sourceProviderId, input.providerId),
        eq(findings.fingerprintVersion, FINDING_FINGERPRINT_VERSION),
      ),
    )
    .for("update");
  const existingByFingerprint = new Map(existing.map((row) => [row.fingerprint, row]));

  const result = { present: 0, missing: 0, indeterminate: 0 };

  for (const { candidate, fingerprint } of observed) {
    const prior = existingByFingerprint.get(fingerprint);
    const next = applyObservation(
      prior
        ? {
            presenceState: prior.presenceState,
            status: prior.status,
            consecutiveAbsences: prior.consecutiveAbsences,
          }
        : INITIAL_FINDING_STATE,
      "PRESENT",
    );

    let findingId: string;
    if (prior) {
      await transaction
        .update(findings)
        .set({
          presenceState: next.presenceState,
          status: next.status,
          consecutiveAbsences: next.consecutiveAbsences,
          title: candidate.title,
          lastSeenAt: input.observedAt,
          lastCheckedAt: input.observedAt,
          updatedAt: sql`now()`,
        })
        .where(eq(findings.id, prior.id));
      findingId = prior.id;
    } else {
      const [created] = await transaction
        .insert(findings)
        .values({
          userId: input.userId,
          identityId: input.identityId,
          matchedIdentifierId: input.matchedIdentifierId,
          type: candidate.findingType,
          sourceProviderId: input.providerId,
          title: candidate.title,
          normalizedHost: candidate.normalizedHost,
          providerExternalId: candidate.providerExternalId,
          fingerprint,
          fingerprintVersion: FINDING_FINGERPRINT_VERSION,
          presenceState: next.presenceState,
          status: next.status,
          consecutiveAbsences: next.consecutiveAbsences,
          firstSeenAt: input.observedAt,
          lastSeenAt: input.observedAt,
          lastCheckedAt: input.observedAt,
        })
        .returning({ id: findings.id });
      if (!created) throw new Error("FINDING_CREATE_FAILED");
      findingId = created.id;
    }

    await appendObservation(transaction, {
      findingId,
      userId: input.userId,
      providerRunId: input.providerRunId,
      presence: "PRESENT",
      observedAt: input.observedAt,
      sourceDate: candidate.sourceDate,
      contentFingerprint: computeContentFingerprint(candidate.contentFields),
      parserVersion: input.parserVersion,
    });
    result.present += 1;
  }

  const observedFingerprints = new Set(observed.map((entry) => entry.fingerprint));
  const absent = existing.filter((row) => !observedFingerprints.has(row.fingerprint));
  if (absent.length === 0) return result;

  const absencePresence = presenceForScanResult({
    scanOutcome: input.scanOutcome,
    observedInResults: false,
  });

  for (const row of absent) {
    const current: FindingTemporalState = {
      presenceState: row.presenceState,
      status: row.status,
      consecutiveAbsences: row.consecutiveAbsences,
    };
    const next = applyObservation(current, absencePresence);
    await transaction
      .update(findings)
      .set({
        presenceState: next.presenceState,
        status: next.status,
        consecutiveAbsences: next.consecutiveAbsences,
        lastCheckedAt: input.observedAt,
        updatedAt: sql`now()`,
      })
      .where(eq(findings.id, row.id));

    await appendObservation(transaction, {
      findingId: row.id,
      userId: input.userId,
      providerRunId: input.providerRunId,
      presence: absencePresence,
      observedAt: input.observedAt,
      sourceDate: null,
      // An absence has no content; the fingerprint records the absent
      // resource's identity so the row is still self-describing.
      contentFingerprint: computeContentFingerprint([row.fingerprint, absencePresence]),
      parserVersion: input.parserVersion,
    });

    if (absencePresence === "MISSING") result.missing += 1;
    else result.indeterminate += 1;
  }

  return result;
}

async function appendObservation(
  transaction: DatabaseTransaction,
  input: {
    readonly findingId: string;
    readonly userId: string;
    readonly providerRunId: string;
    readonly presence: ObservationPresence;
    readonly observedAt: Date;
    readonly sourceDate: string | null;
    readonly contentFingerprint: string;
    readonly parserVersion: string;
  },
): Promise<void> {
  const [previous] = await transaction
    .select({ id: observations.id })
    .from(observations)
    .where(eq(observations.findingId, input.findingId))
    .orderBy(desc(observations.observedAt), desc(observations.id))
    .limit(1);

  await transaction.insert(observations).values({
    findingId: input.findingId,
    userId: input.userId,
    providerRunId: input.providerRunId,
    presence: input.presence,
    observedAt: input.observedAt,
    sourceDate: input.sourceDate,
    contentFingerprint: input.contentFingerprint,
    parserVersion: input.parserVersion,
    previousObservationId: previous?.id ?? null,
  });
}

/** Reads the tenant's current findings for display, newest activity first. */
export async function listFindings(
  transaction: DatabaseTransaction,
  input: { readonly userId: string; readonly limit: number },
) {
  return transaction
    .select({
      id: findings.id,
      type: findings.type,
      title: findings.title,
      sourceProviderId: findings.sourceProviderId,
      normalizedHost: findings.normalizedHost,
      presenceState: findings.presenceState,
      status: findings.status,
      firstSeenAt: findings.firstSeenAt,
      lastSeenAt: findings.lastSeenAt,
      lastCheckedAt: findings.lastCheckedAt,
    })
    .from(findings)
    .where(eq(findings.userId, input.userId))
    .orderBy(desc(findings.lastCheckedAt), desc(findings.id))
    .limit(input.limit);
}

/** Observation history for one finding, oldest first, for provenance display. */
export async function listObservations(
  transaction: DatabaseTransaction,
  input: { readonly userId: string; readonly findingIds: readonly string[] },
) {
  if (input.findingIds.length === 0) return [];
  return transaction
    .select({
      id: observations.id,
      findingId: observations.findingId,
      presence: observations.presence,
      observedAt: observations.observedAt,
      contentFingerprint: observations.contentFingerprint,
      parserVersion: observations.parserVersion,
    })
    .from(observations)
    .where(
      and(
        eq(observations.userId, input.userId),
        inArray(observations.findingId, [...input.findingIds]),
      ),
    )
    .orderBy(observations.observedAt, observations.id);
}
