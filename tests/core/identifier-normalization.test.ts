import { maskEmail, normalizeEmail } from "@/core/identifier-normalization";
import { describe, expect, it } from "vitest";

describe("email normalization", () => {
  it("trims and lowercases a valid email", () => {
    expect(normalizeEmail("  Person@Example.TEST ")).toBe("person@example.test");
  });

  it("rejects malformed values", () => {
    expect(() => normalizeEmail("not-an-email")).toThrow();
  });

  it("produces a display value without persisting the full address", () => {
    const masked = maskEmail("person@example.test");
    expect(masked).toBe("p***@***.test");
    expect(masked).not.toContain("person");
    expect(masked).not.toContain("example");
  });
});
