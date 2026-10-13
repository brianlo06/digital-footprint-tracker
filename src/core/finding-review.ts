import {
  CONSECUTIVE_ABSENCES_FOR_RESOLVED,
  type FindingStatus,
  type FindingTemporalState,
} from "./observation-rules";

/**
 * Pure review rules for the Phase 4 finding workflow. A review records what
 * the account holder says about a finding; it never edits what a provider
 * observed, so presence and the absence streak are untouched.
 */

export const FINDING_REVIEW_DECISIONS = [
  "REVIEWED",
  "CONFIRMED",
  "FALSE_POSITIVE",
  "IGNORED",
  "RESET",
] as const;
export type FindingReviewDecision = (typeof FINDING_REVIEW_DECISIONS)[number];

const REVIEW_STATUSES: ReadonlySet<FindingStatus> = new Set([
  "REVIEWED",
  "CONFIRMED",
  "FALSE_POSITIVE",
  "IGNORED",
]);

/** Statuses kept out of the default overview because the user dismissed them. */
export const DISMISSED_FINDING_STATUSES = ["FALSE_POSITIVE", "IGNORED"] as const;

export function isFindingReviewDecision(value: unknown): value is FindingReviewDecision {
  return (
    typeof value === "string" && (FINDING_REVIEW_DECISIONS as readonly string[]).includes(value)
  );
}

/**
 * The status automatic rules would hold for this temporal state had the user
 * never reviewed the finding. Undoing a review returns here instead of to a
 * remembered prior status, so an undo can never resurrect a stale conclusion.
 */
export function automaticStatusFor(
  state: Pick<FindingTemporalState, "presenceState" | "consecutiveAbsences">,
): FindingStatus {
  return state.presenceState === "MISSING" &&
    state.consecutiveAbsences >= CONSECUTIVE_ABSENCES_FOR_RESOLVED
    ? "RESOLVED"
    : "NEW";
}

/**
 * Returns the status a decision leads to, or null when the decision does not
 * apply: repeating the current label, undoing a review that was never made,
 * or downgrading a firm label to the weaker "reviewed".
 */
export function statusAfterReview(
  current: FindingTemporalState,
  decision: FindingReviewDecision,
): FindingStatus | null {
  if (decision === "RESET") {
    return REVIEW_STATUSES.has(current.status) ? automaticStatusFor(current) : null;
  }
  if (decision === current.status) return null;
  // Remediation tracking has its own lifecycle and is not reviewable here.
  if (current.status === "REMEDIATION_IN_PROGRESS") return null;
  if (decision === "REVIEWED" && REVIEW_STATUSES.has(current.status)) return null;
  return decision;
}

/** The decisions that would change this finding, in display order. */
export function availableReviewDecisions(
  current: FindingTemporalState,
): readonly FindingReviewDecision[] {
  return FINDING_REVIEW_DECISIONS.filter(
    (decision) => statusAfterReview(current, decision) !== null,
  );
}
