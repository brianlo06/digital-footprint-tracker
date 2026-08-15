import { createSyntheticBreachProvider } from "@/providers/breach/synthetic-breach-provider";
import type { SyntheticBreachScenario } from "@/providers/breach/synthetic-fixtures";
import { ProviderContractError } from "@/providers/provider.contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const verifiedEmailReference = {
  identifierId: "00000000-0000-4000-8000-000000000001",
  identifierType: "EMAIL" as const,
  verificationScope: "VERIFIED_EMAIL_SELF" as const,
};

const scanContext = {
  scanId: "00000000-0000-4000-8000-000000000002",
  providerRunId: "00000000-0000-4000-8000-000000000003",
  consentRecordId: "00000000-0000-4000-8000-000000000004",
  idempotencyKey: "synthetic:run:0001",
  deadline: "2099-01-01T00:00:00.000Z",
  maxResults: 10,
  costBudgetUnits: 0,
};

describe("synthetic breach provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("supports only self-verified email breach metadata", () => {
    const provider = createSyntheticBreachProvider();

    expect(provider.supports(verifiedEmailReference, "BREACH_METADATA_BY_VERIFIED_EMAIL")).toBe(
      true,
    );
    expect(
      provider.supports(
        { ...verifiedEmailReference, identifierType: "USERNAME" },
        "BREACH_METADATA_BY_VERIFIED_EMAIL",
      ),
    ).toBe(false);
  });

  it("validates only an opaque UUID email reference with the exact verification scope", async () => {
    const provider = createSyntheticBreachProvider();

    await expect(provider.validate(verifiedEmailReference)).resolves.toEqual(
      verifiedEmailReference,
    );
    await expect(
      provider.validate({ ...verifiedEmailReference, identifierId: "not-an-opaque-id" }),
    ).rejects.toMatchObject({
      descriptor: { kind: "VALIDATION", safeCode: "PROVIDER_INPUT_INVALID" },
    });
  });

  it("returns and normalizes bounded fictional metadata without network access", async () => {
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    const provider = createSyntheticBreachProvider("SUCCESS");
    const input = await provider.validate(verifiedEmailReference);

    await expect(provider.estimateCost(input)).resolves.toBe(0);
    const page = await provider.scan(scanContext, input);
    expect(page).toMatchObject({ billedUnits: 0, records: [expect.any(Object)] });
    expect(page.records).toHaveLength(1);
    expect(provider.normalize(page.records[0])).toEqual([
      expect.objectContaining({
        type: "BREACH",
        title: "Synthetic Commerce",
        confidence: "HIGH",
        sensitivity: "SENSITIVE",
        presence: "PRESENT",
      }),
    ]);
    expect(networkCall).not.toHaveBeenCalled();
  });

  it.each([
    ["EMPTY", 0],
    ["DUPLICATE", 2],
  ] as const)("provides the %s contract fixture", async (scenario, expectedRecords) => {
    const provider = createSyntheticBreachProvider(scenario);
    const input = await provider.validate(verifiedEmailReference);

    const page = await provider.scan(scanContext, input);
    expect(page.billedUnits).toBe(0);
    expect(page.records).toHaveLength(expectedRecords);
  });

  it.each(["MALFORMED", "HOSTILE", "SCHEMA_CHANGE"] as const)(
    "rejects the %s fixture before normalization escapes",
    async (scenario) => {
      const provider = createSyntheticBreachProvider(scenario);
      const input = await provider.validate(verifiedEmailReference);
      const page = await provider.scan(scanContext, input);

      expect(() => provider.normalize(page.records[0])).toThrowError(
        expect.objectContaining({
          descriptor: {
            kind: "PERMANENT",
            retryable: false,
            safeCode: "PROVIDER_RESPONSE_SCHEMA_INVALID",
          },
        }),
      );
    },
  );

  it.each([
    ["TIMEOUT", "TIMEOUT", true, "PROVIDER_TIMEOUT", undefined],
    ["AUTHENTICATION", "AUTHORIZATION", false, "PROVIDER_AUTHORIZATION_DENIED", undefined],
    ["RATE_LIMIT", "RATE_LIMIT", true, "PROVIDER_RATE_LIMITED", 60],
    ["OUTAGE", "UPSTREAM", true, "PROVIDER_UNAVAILABLE", undefined],
  ] as const)(
    "maps %s to a bounded error descriptor",
    async (scenario, kind, retryable, safeCode, retryAfterSeconds) => {
      const provider = createSyntheticBreachProvider(scenario);
      const input = await provider.validate(verifiedEmailReference);
      const expectedDescriptor = {
        kind,
        retryable,
        safeCode,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      };

      await expect(provider.scan(scanContext, input)).rejects.toMatchObject({
        descriptor: expectedDescriptor,
      });
    },
  );

  it("provides bounded pagination and rejects an unknown cursor", async () => {
    const provider = createSyntheticBreachProvider("PAGINATED");
    const input = await provider.validate(verifiedEmailReference);

    const first = await provider.scan(scanContext, input);
    expect(first).toMatchObject({ records: [expect.any(Object)], nextCursor: "synthetic-page-2" });
    await expect(provider.scan(scanContext, input, first.nextCursor)).resolves.toMatchObject({
      records: [expect.any(Object)],
      nextCursor: undefined,
    });
    await expect(provider.scan(scanContext, input, "unknown-page")).rejects.toMatchObject({
      descriptor: { kind: "VALIDATION", safeCode: "PROVIDER_CURSOR_INVALID" },
    });
  });

  it("rejects invalid context and result budgets before returning a page", async () => {
    const provider = createSyntheticBreachProvider("DUPLICATE");
    const input = await provider.validate(verifiedEmailReference);

    await expect(
      provider.scan({ ...scanContext, costBudgetUnits: 1 }, input),
    ).rejects.toMatchObject({
      descriptor: { kind: "VALIDATION", safeCode: "PROVIDER_CONTEXT_INVALID" },
    });
    await expect(provider.scan({ ...scanContext, maxResults: 1 }, input)).rejects.toMatchObject({
      descriptor: { kind: "BUDGET", safeCode: "PROVIDER_RESULT_LIMIT_EXCEEDED" },
    });
  });

  it("rejects an expired scan deadline without invoking fixture work", async () => {
    const provider = createSyntheticBreachProvider();
    const input = await provider.validate(verifiedEmailReference);

    await expect(
      provider.scan({ ...scanContext, deadline: "2000-01-01T00:00:00.000Z" }, input),
    ).rejects.toMatchObject({
      descriptor: {
        kind: "TIMEOUT",
        retryable: false,
        safeCode: "PROVIDER_DEADLINE_EXPIRED",
      },
    });
  });

  it.each([
    ["SUCCESS", "HEALTHY"],
    ["RATE_LIMIT", "RATE_LIMITED"],
    ["OUTAGE", "UNAVAILABLE"],
  ] as const)("reports %s fixture health as %s", async (scenario, health) => {
    await expect(
      createSyntheticBreachProvider(scenario as SyntheticBreachScenario).healthCheck(),
    ).resolves.toBe(health);
  });

  it("uses a safe error message identical to its opaque code", () => {
    const error = new ProviderContractError({
      kind: "PERMANENT",
      retryable: false,
      safeCode: "SYNTHETIC_SAFE_CODE",
    });

    expect(error.message).toBe("SYNTHETIC_SAFE_CODE");
  });
});
