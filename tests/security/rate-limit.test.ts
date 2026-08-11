import { resolveTrustedNetworkIdentifier } from "@/security/rate-limit";
import { describe, expect, it } from "vitest";

describe("trusted network identifier resolution", () => {
  it("uses one synthetic network in local development", () => {
    expect(
      resolveTrustedNetworkIdentifier(new Headers({ "x-client-ip": "not-an-ip" }), {
        appEnv: "local",
      }),
    ).toBe("local-development-network");
  });

  it("requires an explicitly trusted ingress header outside local development", () => {
    expect(() => resolveTrustedNetworkIdentifier(new Headers(), { appEnv: "preview" })).toThrow(
      "TRUSTED_CLIENT_IP_HEADER_REQUIRED",
    );
  });

  it("accepts a single valid IP and rejects forwarding chains or malformed values", () => {
    const configuration = {
      appEnv: "production" as const,
      trustedClientIpHeader: "x-trusted-client-ip",
    };
    expect(
      resolveTrustedNetworkIdentifier(
        new Headers({ "x-trusted-client-ip": "2001:db8::7" }),
        configuration,
      ),
    ).toBe("2001:db8::7");
    expect(() =>
      resolveTrustedNetworkIdentifier(
        new Headers({ "x-trusted-client-ip": "192.0.2.1, 198.51.100.2" }),
        configuration,
      ),
    ).toThrow("TRUSTED_CLIENT_IP_REQUIRED");
    expect(() =>
      resolveTrustedNetworkIdentifier(
        new Headers({ "x-trusted-client-ip": "not-an-ip" }),
        configuration,
      ),
    ).toThrow("TRUSTED_CLIENT_IP_REQUIRED");
  });
});
