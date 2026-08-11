import { serializeSafeLog } from "@/security/logger";
import { describe, expect, it } from "vitest";

describe("privacy-safe logging", () => {
  it("drops fields outside the telemetry allowlist", () => {
    const output = serializeSafeLog({
      event: "IDENTIFIER_STORED",
      identifierId: "identifier_123",
      query: "person@example.test",
      responseBody: "sensitive provider result",
    });

    expect(output).toContain("IDENTIFIER_STORED");
    expect(output).toContain("identifier_123");
    expect(output).not.toContain("person@example.test");
    expect(output).not.toContain("sensitive provider result");
  });
});
