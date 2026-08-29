/**
 * Pure temporal rules for ADR 0006. A provider outage must never look like
 * removal, and a removal must never be inferred from one absent result, so
 * presence and status are derived here rather than at each call site.
 */

export type ObservationPresence = "PRESENT" | "MISSING" | "INDETERMINATE";
export type FindingPresenceState = "PRESENT" | "MISSING" | "UNKNOWN";
export type FindingStatus =
  | "NEW"
  | "REVIEWED"
  | "CONFIRMED"
  | "FALSE_POSITIVE"
  | "IGNORED"
  | "REMEDIATION_IN_PROGRESS"
  | "RESOLVED"
  | "REAPPEARED";

/**
 * Consecutive confirmed absences required before a finding is called
 * resolved. One absence is not proof: providers drop and restore records.
 */
export const CONSECUTIVE_ABSENCES_FOR_RESOLVED = 2;

/** Statuses a user set deliberately; automatic rules must not overwrite them. */
const USER_OWNED_STATUSES: ReadonlySet<FindingStatus> = new Set([
  "REVIEWED",
  "CONFIRMED",
  "FALSE_POSITIVE",
  "IGNORED",
  "REMEDIATION_IN_PROGRESS",
]);

/**
 * A scan only proves absence when it actually completed against a healthy
 * provider. A failed or partial scan yields INDETERMINATE, never MISSING.
 */
export function presenceForScanResult(input: {
  readonly scanOutcome: "COMPLETED" | "PARTIAL" | "FAILED";
  readonly observedInResults: boolean;
}): ObservationPresence {
  if (input.observedInResults) return "PRESENT";
  if (input.scanOutcome === "COMPLETED") return "MISSING";
  return "INDETERMINATE";
}

export interface FindingTemporalState {
  readonly presenceState: FindingPresenceState;
  readonly status: FindingStatus;
  readonly consecutiveAbsences: number;
}

export const INITIAL_FINDING_STATE: FindingTemporalState = {
  presenceState: "PRESENT",
  status: "NEW",
  consecutiveAbsences: 0,
};

/**
 * Applies one observation to a finding's temporal state. INDETERMINATE
 * deliberately changes nothing except that the finding was checked: it
 * neither advances nor resets the absence streak, because an outage is not
 * evidence either way.
 */
export function applyObservation(
  current: FindingTemporalState,
  presence: ObservationPresence,
): FindingTemporalState {
  if (presence === "INDETERMINATE") return current;

  const userOwned = USER_OWNED_STATUSES.has(current.status);

  if (presence === "PRESENT") {
    const reappeared = current.presenceState === "MISSING" || current.status === "RESOLVED";
    return {
      presenceState: "PRESENT",
      status: userOwned ? current.status : reappeared ? "REAPPEARED" : current.status,
      consecutiveAbsences: 0,
    };
  }

  const consecutiveAbsences = current.consecutiveAbsences + 1;
  const resolved = consecutiveAbsences >= CONSECUTIVE_ABSENCES_FOR_RESOLVED;
  return {
    presenceState: "MISSING",
    status: userOwned ? current.status : resolved ? "RESOLVED" : current.status,
    consecutiveAbsences,
  };
}
