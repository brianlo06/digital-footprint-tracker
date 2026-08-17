import "server-only";

import { z } from "zod";

import type { CandidateFinding, ProviderHealth } from "@/core/domain.types";
import {
  type FootprintProvider,
  type ProviderCapability,
  ProviderContractError,
  type ProviderErrorDescriptor,
  type ProviderInputReference,
  type ProviderPage,
  type ScanContext,
} from "@/providers/provider.contracts";
import {
  type SyntheticBreachRecord,
  type SyntheticBreachScenario,
  syntheticBreachRecordSchema,
  syntheticFixturePage,
} from "@/providers/breach/synthetic-fixtures";

const syntheticInputSchema = z.strictObject({
  identifierId: z.uuid(),
  identifierType: z.literal("EMAIL"),
  verificationScope: z.literal("VERIFIED_EMAIL_SELF"),
});

const scanContextSchema = z.strictObject({
  scanId: z.uuid(),
  providerRunId: z.uuid(),
  consentRecordId: z.uuid(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/),
  deadline: z.iso.datetime({ offset: true }),
  maxResults: z.number().int().min(1).max(10),
  costBudgetUnits: z.literal(0),
});

export type SyntheticBreachInput = z.infer<typeof syntheticInputSchema>;

function providerFailure(descriptor: ProviderErrorDescriptor): never {
  throw new ProviderContractError(descriptor);
}

function validateContext(context: ScanContext): void {
  const parsed = scanContextSchema.safeParse(context);
  if (!parsed.success) {
    providerFailure({
      kind: "VALIDATION",
      retryable: false,
      safeCode: "PROVIDER_CONTEXT_INVALID",
    });
  }

  if (Date.parse(parsed.data.deadline) <= Date.now()) {
    providerFailure({
      kind: "TIMEOUT",
      retryable: false,
      safeCode: "PROVIDER_DEADLINE_EXPIRED",
    });
  }
}

function simulatedFailure(scenario: SyntheticBreachScenario): void {
  switch (scenario) {
    case "TIMEOUT":
      providerFailure({ kind: "TIMEOUT", retryable: true, safeCode: "PROVIDER_TIMEOUT" });
    case "AUTHENTICATION":
      providerFailure({
        kind: "AUTHORIZATION",
        retryable: false,
        safeCode: "PROVIDER_AUTHORIZATION_DENIED",
      });
    case "RATE_LIMIT":
      providerFailure({
        kind: "RATE_LIMIT",
        retryable: true,
        retryAfterSeconds: 60,
        safeCode: "PROVIDER_RATE_LIMITED",
      });
    case "OUTAGE":
      providerFailure({ kind: "UPSTREAM", retryable: true, safeCode: "PROVIDER_UNAVAILABLE" });
    default:
      return;
  }
}

function normalizeSyntheticRecord(record: unknown): readonly CandidateFinding[] {
  const parsed = syntheticBreachRecordSchema.safeParse(record);
  if (!parsed.success) {
    providerFailure({
      kind: "PERMANENT",
      retryable: false,
      safeCode: "PROVIDER_RESPONSE_SCHEMA_INVALID",
    });
  }

  const breach: SyntheticBreachRecord = parsed.data;
  return [
    {
      type: "BREACH",
      category: "Breach metadata",
      title: breach.breachName,
      description:
        "Provider-reported breach metadata. This does not prove current account compromise.",
      canonicalUrl: breach.sourceUrl,
      confidence: "HIGH",
      sensitivity: "SENSITIVE",
      presence: "PRESENT",
      evidence: [
        {
          kind: "BREACH_METADATA",
          redactedSummary: `${breach.breachName} reported ${breach.breachDate}`,
          sourceUrl: breach.sourceUrl,
          providerExternalId: breach.providerBreachId,
          parserVersion: "synthetic-breach-v1",
          confidenceMethodVersion: "exact-verified-email-v1",
          sourceDate: breach.breachDate,
          providerFirstSeenAt: breach.providerAddedAt,
          providerLastSeenAt: breach.providerModifiedAt,
          dataCategories: breach.dataCategories,
          isVerified: breach.isVerified,
          isSensitive: breach.isSensitive,
          isRetired: breach.isRetired,
        },
      ],
    },
  ];
}

export function createSyntheticBreachProvider(
  scenario: SyntheticBreachScenario = "SUCCESS",
): FootprintProvider<SyntheticBreachInput, unknown> {
  return {
    id: "synthetic-breach",
    category: "BREACH",
    adapterVersion: "synthetic-breach-v1",
    parserVersion: "synthetic-breach-v1",

    supports(input: ProviderInputReference, capability: ProviderCapability): boolean {
      return (
        capability === "BREACH_METADATA_BY_VERIFIED_EMAIL" &&
        input.identifierType === "EMAIL" &&
        input.verificationScope === "VERIFIED_EMAIL_SELF"
      );
    },

    async validate(input: ProviderInputReference): Promise<SyntheticBreachInput> {
      const parsed = syntheticInputSchema.safeParse(input);
      if (!parsed.success) {
        providerFailure({
          kind: "VALIDATION",
          retryable: false,
          safeCode: "PROVIDER_INPUT_INVALID",
        });
      }
      return parsed.data;
    },

    async estimateCost(): Promise<number> {
      return 0;
    },

    async scan(
      context: ScanContext,
      _input: SyntheticBreachInput,
      cursor?: string,
    ): Promise<ProviderPage<unknown>> {
      validateContext(context);
      simulatedFailure(scenario);
      const page = syntheticFixturePage(scenario, cursor);
      if (page.nextCursor === "invalid-cursor") {
        providerFailure({
          kind: "VALIDATION",
          retryable: false,
          safeCode: "PROVIDER_CURSOR_INVALID",
        });
      }
      if (page.records.length > context.maxResults) {
        providerFailure({
          kind: "BUDGET",
          retryable: false,
          safeCode: "PROVIDER_RESULT_LIMIT_EXCEEDED",
        });
      }
      return { records: page.records, nextCursor: page.nextCursor, billedUnits: 0 };
    },

    normalize(record: unknown): readonly CandidateFinding[] {
      return normalizeSyntheticRecord(record);
    },

    async healthCheck(): Promise<ProviderHealth> {
      if (scenario === "RATE_LIMIT") return "RATE_LIMITED";
      if (scenario === "OUTAGE") return "UNAVAILABLE";
      return "HEALTHY";
    },
  };
}
