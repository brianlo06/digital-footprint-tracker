import type { FindingReviewDecision } from "@/core/finding-review";
import type {
  FindingPresenceState,
  FindingStatus,
  ObservationPresence,
} from "@/core/observation-rules";

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  NEW: "new",
  REVIEWED: "reviewed",
  CONFIRMED: "confirmed mine",
  FALSE_POSITIVE: "not mine",
  IGNORED: "ignored",
  REMEDIATION_IN_PROGRESS: "remediation in progress",
  RESOLVED: "resolved",
  REAPPEARED: "reappeared",
};

export const FINDING_STATUS_EXPLANATIONS: Record<FindingStatus, string> = {
  NEW: "You have not reviewed this finding yet.",
  REVIEWED: "You have looked at this finding without deciding whether it relates to you.",
  CONFIRMED:
    "You confirmed this relates to you. That is your statement; it is not independent verification.",
  FALSE_POSITIVE:
    "You said this does not relate to you. It stays out of the overview, its history is kept, and you can undo this.",
  IGNORED:
    "You chose to ignore this finding. It stays out of the overview, checks still record it, and you can undo this.",
  REMEDIATION_IN_PROGRESS: "Remediation has been started for this finding.",
  RESOLVED:
    "Two consecutive completed checks did not report this. That is absence from this provider, not proof that the underlying exposure is gone.",
  REAPPEARED: "This was reported again after it had been absent.",
};

export const FINDING_PRESENCE_EXPLANATIONS: Record<FindingPresenceState, string> = {
  PRESENT: "The most recent conclusive check reported this.",
  MISSING: "The most recent conclusive check completed without reporting this.",
  UNKNOWN: "No conclusive check has established whether this is still reported.",
};

export const OBSERVATION_PRESENCE_LABELS: Record<ObservationPresence, string> = {
  PRESENT: "Reported",
  MISSING: "Not reported",
  INDETERMINATE: "Inconclusive",
};

export const OBSERVATION_PRESENCE_EXPLANATIONS: Record<ObservationPresence, string> = {
  PRESENT: "The provider returned this in a check.",
  MISSING: "A fully completed check did not return this.",
  INDETERMINATE:
    "The check failed or was incomplete, so it says nothing about whether this is still reported.",
};

export const REVIEW_DECISION_LABELS: Record<FindingReviewDecision, string> = {
  REVIEWED: "Mark as reviewed",
  CONFIRMED: "This relates to me",
  FALSE_POSITIVE: "This is not me",
  IGNORED: "Ignore this finding",
  RESET: "Undo my review",
};
