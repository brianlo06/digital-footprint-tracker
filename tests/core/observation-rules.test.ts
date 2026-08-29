import {
  applyObservation,
  CONSECUTIVE_ABSENCES_FOR_RESOLVED,
  INITIAL_FINDING_STATE,
  presenceForScanResult,
  type FindingTemporalState,
} from "@/core/observation-rules";
import { describe, expect, it } from "vitest";

describe("presence for a scan result", () => {
  it("reports PRESENT whenever the provider returned the resource", () => {
    for (const scanOutcome of ["COMPLETED", "PARTIAL", "FAILED"] as const) {
      expect(presenceForScanResult({ scanOutcome, observedInResults: true })).toBe("PRESENT");
    }
  });

  it("only infers MISSING from a fully completed scan", () => {
    expect(presenceForScanResult({ scanOutcome: "COMPLETED", observedInResults: false })).toBe(
      "MISSING",
    );
  });

  it.each(["PARTIAL", "FAILED"] as const)(
    "never turns a %s scan's absence into MISSING",
    (scanOutcome) => {
      expect(presenceForScanResult({ scanOutcome, observedInResults: false })).toBe(
        "INDETERMINATE",
      );
    },
  );
});

describe("finding temporal state", () => {
  it("starts a newly seen finding as present and NEW", () => {
    expect(INITIAL_FINDING_STATE).toEqual({
      presenceState: "PRESENT",
      status: "NEW",
      consecutiveAbsences: 0,
    });
  });

  it("leaves state untouched for an indeterminate observation", () => {
    const current: FindingTemporalState = {
      presenceState: "PRESENT",
      status: "NEW",
      consecutiveAbsences: 1,
    };
    expect(applyObservation(current, "INDETERMINATE")).toEqual(current);
  });

  it("requires consecutive absences before resolving", () => {
    let state = INITIAL_FINDING_STATE;
    for (let absence = 1; absence < CONSECUTIVE_ABSENCES_FOR_RESOLVED; absence += 1) {
      state = applyObservation(state, "MISSING");
      expect(state.presenceState).toBe("MISSING");
      expect(state.status).not.toBe("RESOLVED");
    }
    state = applyObservation(state, "MISSING");
    expect(state).toMatchObject({
      presenceState: "MISSING",
      status: "RESOLVED",
      consecutiveAbsences: CONSECUTIVE_ABSENCES_FOR_RESOLVED,
    });
  });

  it("does not let an outage between absences resolve a finding early", () => {
    let state = applyObservation(INITIAL_FINDING_STATE, "MISSING");
    state = applyObservation(state, "INDETERMINATE");
    expect(state.status).not.toBe("RESOLVED");
    expect(state.consecutiveAbsences).toBe(1);
  });

  it("marks a returning finding REAPPEARED after it went missing", () => {
    let state = applyObservation(INITIAL_FINDING_STATE, "MISSING");
    state = applyObservation(state, "MISSING");
    expect(state.status).toBe("RESOLVED");

    state = applyObservation(state, "PRESENT");
    expect(state).toEqual({
      presenceState: "PRESENT",
      status: "REAPPEARED",
      consecutiveAbsences: 0,
    });
  });

  it("keeps a continuously present finding out of REAPPEARED", () => {
    const state = applyObservation(INITIAL_FINDING_STATE, "PRESENT");
    expect(state).toEqual({ presenceState: "PRESENT", status: "NEW", consecutiveAbsences: 0 });
  });

  it.each([
    "REVIEWED",
    "CONFIRMED",
    "FALSE_POSITIVE",
    "IGNORED",
    "REMEDIATION_IN_PROGRESS",
  ] as const)("never overwrites the user-owned status %s", (status) => {
    const current: FindingTemporalState = {
      presenceState: "PRESENT",
      status,
      consecutiveAbsences: 0,
    };
    const afterAbsences = applyObservation(applyObservation(current, "MISSING"), "MISSING");
    expect(afterAbsences.status).toBe(status);
    // Presence still tracks reality even while the user's status stands.
    expect(afterAbsences.presenceState).toBe("MISSING");
    expect(applyObservation(afterAbsences, "PRESENT").status).toBe(status);
  });
});
