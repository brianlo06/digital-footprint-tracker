import { describe, expect, it } from "vitest";

import {
  createContentSecurityPolicy,
  createNonce,
  PRIVATE_DYNAMIC_CACHE_CONTROL,
} from "@/security/content-security-policy";

describe("content security policy", () => {
  it("uses a fresh high-entropy nonce", () => {
    const first = createNonce();
    const second = createNonce();

    expect(first).not.toBe(second);
    expect(Buffer.from(first, "base64")).toHaveLength(16);
    expect(Buffer.from(second, "base64")).toHaveLength(16);
  });

  it("builds a strict production policy", () => {
    const policy = createContentSecurityPolicy("test-nonce", false);

    expect(policy).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
    expect(policy).toContain("style-src 'self' 'nonce-test-nonce'");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).not.toContain("style-src 'self' 'nonce-test-nonce' 'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("allows only the development features required by the local runtime", () => {
    const policy = createContentSecurityPolicy("test-nonce", true);

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("connect-src 'self' ws:");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("prevents storage and edge transformation of nonce-bearing responses", () => {
    expect(PRIVATE_DYNAMIC_CACHE_CONTROL.split(", ")).toEqual([
      "private",
      "no-cache",
      "no-store",
      "max-age=0",
      "must-revalidate",
      "no-transform",
    ]);
  });
});
