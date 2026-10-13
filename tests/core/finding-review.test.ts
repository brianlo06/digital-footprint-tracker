import {
  automaticStatusFor,
  availableReviewDecisions,
  isFindingReviewDecision,
  statusAfterReview,
} from "@/core/finding-review";
import { applyObservation, type FindingTemporalState } from "@/core/observation-rules";
import { describe, expect, it } from "vitest";

const present = (status: FindingTemporalState["status"]): FindingTemporalState => ({
  presenceState: "PRESENT",
  status,
  consecutiveAbsences: 0,
});

describe("finding review rules", () => {
  it("accepts only known decisions", () => {
    expect(isFindingReviewDecision("CONFIRMED")).toBe(true);
    for (const value of ["RESOLVED", "REMEDIATION_IN_PROGRESS", "confirmed", "", null, 7]) {
      expect(isFindingReviewDecision(value)).toBe(false);
    }
  });

  it("lets a new finding take any review label but not an undo", () => {
    expect(availableReviewDecisions(present("NEW"))).toEqual([
      "REVIEWED",
      "CONFIRMED",
      "FALSE_POSITIVE",
      "IGNORED",
    ]);
    expect(statusAfterReview(present("NEW"), "RESET")).toBeNull();
  });

  it("allows correcting a label, never repeating it or weakening it to reviewed", () => {
    expect(statusAfterReview(present("CONFIRMED"), "CONFIRMED")).toBeNull();
    expect(statusAfterReview(present("CONFIRMED"), "REVIEWED")).toBeNull();
    expect(statusAfterReview(present("CONFIRMED"), "FALSE_POSITIVE")).toBe("FALSE_POSITIVE");
    expect(statusAfterReview(present("FALSE_POSITIVE"), "CONFIRMED")).toBe("CONFIRMED");
    expect(statusAfterReview(present("REVIEWED"), "IGNORED")).toBe("IGNORED");
  });

  it("reviews automatic statuses, including resolved and reappeared", () => {
    expect(statusAfterReview(present("REAPPEARED"), "REVIEWED")).toBe("REVIEWED");
    const resolved: FindingTemporalState = {
      presenceState: "MISSING",
      status: "RESOLVED",
      consecutiveAbsences: 2,
    };
    expect(statusAfterReview(resolved, "FALSE_POSITIVE")).toBe("FALSE_POSITIVE");
    expect(statusAfterReview(resolved, "RESET")).toBeNull();
  });

  it("leaves remediation to its own lifecycle", () => {
    expect(availableReviewDecisions(present("REMEDIATION_IN_PROGRESS"))).toEqual([]);
  });

  it("undoes a review to what automatic rules would hold now", () => {
    expect(statusAfterReview(present("IGNORED"), "RESET")).toBe("NEW");
    expect(
      statusAfterReview(
        { presenceState: "MISSING", status: "FALSE_POSITIVE", consecutiveAbsences: 1 },
        "RESET",
      ),
    ).toBe("NEW");
    expect(
      statusAfterReview(
        { presenceState: "MISSING", status: "CONFIRMED", consecutiveAbsences: 2 },
        "RESET",
      ),
    ).toBe("RESOLVED");
    expect(automaticStatusFor({ presenceState: "UNKNOWN", consecutiveAbsences: 5 })).toBe("NEW");
  });

  it("produces labels that later observations never overwrite", () => {
    for (const decision of ["REVIEWED", "CONFIRMED", "FALSE_POSITIVE", "IGNORED"] as const) {
      const status = statusAfterReview(present("NEW"), decision)!;
      let state: FindingTemporalState = { ...present("NEW"), status };
      for (const presence of ["MISSING", "MISSING", "PRESENT"] as const) {
        state = applyObservation(state, presence);
        expect(state.status).toBe(status);
      }
    }
  });
});
