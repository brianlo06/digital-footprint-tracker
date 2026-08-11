import { evaluateStrictReverification } from "@/security/destructive-action-authorization";
import { describe, expect, it } from "vitest";

describe("destructive action authorization", () => {
  it("requires both the same subject and strict recent reverification", () => {
    expect(evaluateStrictReverification("user_a", "user_a", true)).toBe("AUTHORIZED");
    expect(evaluateStrictReverification("user_a", "user_a", false)).toBe("REVERIFICATION_REQUIRED");
    expect(evaluateStrictReverification("user_a", "user_b", true)).toBe("SUBJECT_MISMATCH");
    expect(evaluateStrictReverification("user_a", "user_b", false)).toBe("SUBJECT_MISMATCH");
  });
});
