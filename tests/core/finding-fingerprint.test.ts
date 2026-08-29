import {
  computeContentFingerprint,
  computeFindingFingerprint,
  FINDING_FINGERPRINT_VERSION,
  normalizeHost,
} from "@/core/finding-fingerprint";
import { describe, expect, it } from "vitest";

const base = {
  findingType: "BREACH",
  providerScope: "synthetic-breach",
  normalizedHost: "example.test",
  identifierLookupToken: "lookup-token-abc",
  normalizedResourceId: "synthetic-commerce-2024",
} as const;

describe("finding fingerprint", () => {
  it("is deterministic and hex-encoded", () => {
    const first = computeFindingFingerprint(base);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(computeFindingFingerprint({ ...base })).toBe(first);
  });

  it("changes when any identity field changes", () => {
    const reference = computeFindingFingerprint(base);
    expect(computeFindingFingerprint({ ...base, findingType: "WEB_MENTION" })).not.toBe(reference);
    expect(computeFindingFingerprint({ ...base, providerScope: "other" })).not.toBe(reference);
    expect(computeFindingFingerprint({ ...base, normalizedHost: "other.test" })).not.toBe(
      reference,
    );
    expect(computeFindingFingerprint({ ...base, identifierLookupToken: "other" })).not.toBe(
      reference,
    );
    expect(computeFindingFingerprint({ ...base, normalizedResourceId: "other" })).not.toBe(
      reference,
    );
  });

  it("changes when the version changes so history is never silently re-identified", () => {
    expect(computeFindingFingerprint({ ...base, fingerprintVersion: "v2" })).not.toBe(
      computeFindingFingerprint(base),
    );
  });

  it("cannot be collided by shifting characters across field boundaries", () => {
    // Without length prefixes these two inputs would hash identically.
    const left = computeFindingFingerprint({
      ...base,
      providerScope: "ab",
      normalizedHost: "cde.test",
    });
    const right = computeFindingFingerprint({
      ...base,
      providerScope: "abc",
      normalizedHost: "de.test",
    });
    expect(left).not.toBe(right);
  });

  it("rejects an empty identity field rather than hashing a blank", () => {
    expect(() => computeFindingFingerprint({ ...base, normalizedResourceId: "" })).toThrow(
      "FINGERPRINT_FIELD_EMPTY",
    );
  });

  it("uses a stable declared version", () => {
    expect(FINDING_FINGERPRINT_VERSION).toMatch(/^v[0-9]{1,3}$/);
  });

  it("hashes only the content fields it is given", () => {
    const first = computeContentFingerprint(["a", "b"]);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(computeContentFingerprint(["a", "b"])).toBe(first);
    expect(computeContentFingerprint(["ab"])).not.toBe(first);
  });
});

describe("host normalization", () => {
  it.each([
    ["https://Example.test/breaches/x", "example.test"],
    ["https://www.example.test/x", "example.test"],
    ["https://example.test./x", "example.test"],
    ["https://example.test:8443/x", "example.test"],
  ])("normalizes %s to %s", (url, expected) => {
    expect(normalizeHost(url)).toBe(expected);
  });

  it.each(["not-a-url", "", "https://"])("rejects %j", (url) => {
    expect(() => normalizeHost(url)).toThrow("FINGERPRINT_SOURCE_URL_INVALID");
  });
});
