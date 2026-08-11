import {
  DisabledAuthGateway,
  getAuthGateway,
  LocalDevelopmentAuthGateway,
  requirePrincipal,
} from "@/security/auth";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("local authentication boundary", () => {
  it("returns only the configured opaque development subject", async () => {
    const gateway = new LocalDevelopmentAuthGateway("local_test_subject", "test");
    await expect(gateway.currentPrincipal()).resolves.toEqual({
      subject: "local_test_subject",
      mode: "local",
    });
  });

  it("cannot be constructed in production", () => {
    expect(() => new LocalDevelopmentAuthGateway("local_test_subject", "production")).toThrow(
      "forbidden",
    );
  });
});

describe("disabled hosted-preview authentication boundary", () => {
  it("never creates a principal and rejects destructive provider operations", async () => {
    const gateway = new DisabledAuthGateway();

    await expect(gateway.currentPrincipal()).resolves.toBeNull();
    await expect(gateway.deletePrincipal()).rejects.toThrow("AUTHENTICATION_DISABLED");
  });

  it("fails closed before database or key configuration is evaluated", async () => {
    vi.stubEnv("AUTH_MODE", "disabled");

    expect(getAuthGateway()).toBeInstanceOf(DisabledAuthGateway);
    await expect(requirePrincipal()).rejects.toThrow("AUTHENTICATION_REQUIRED");
  });
});
