import { LocalDevelopmentAuthGateway } from "@/security/auth";
import { describe, expect, it } from "vitest";

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
