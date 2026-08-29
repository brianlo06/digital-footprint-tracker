import { z } from "zod";

const safeProviderId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const safeProviderText = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 .,'()+/_-]{0,119}$/);
const syntheticSourceUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "example.test";
});

export const syntheticBreachRecordSchema = z.strictObject({
  providerBreachId: safeProviderId,
  breachName: safeProviderText,
  breachDate: z.iso.date(),
  providerAddedAt: z.iso.datetime({ offset: true }),
  providerModifiedAt: z.iso.datetime({ offset: true }),
  dataCategories: z
    .array(z.enum(["Email addresses", "Names", "Geographic locations", "Dates of birth"]))
    .min(1)
    .max(8),
  sourceUrl: syntheticSourceUrl,
  isVerified: z.literal(true),
  isSensitive: z.boolean(),
  isRetired: z.literal(false),
});

export type SyntheticBreachRecord = z.infer<typeof syntheticBreachRecordSchema>;

export type SyntheticBreachScenario =
  | "SUCCESS"
  | "EMPTY"
  | "DUPLICATE"
  | "MALFORMED"
  | "HOSTILE"
  | "SCHEMA_CHANGE"
  | "TIMEOUT"
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "OUTAGE"
  | "DEGRADED"
  | "PAGINATED";

const commerceBreach = {
  providerBreachId: "synthetic-commerce-2024",
  breachName: "Synthetic Commerce",
  breachDate: "2024-01-15",
  providerAddedAt: "2024-02-01T12:00:00.000Z",
  providerModifiedAt: "2024-02-02T12:00:00.000Z",
  dataCategories: ["Email addresses", "Names"],
  sourceUrl: "https://example.test/breaches/synthetic-commerce-2024",
  isVerified: true,
  isSensitive: false,
  isRetired: false,
} as const satisfies SyntheticBreachRecord;

const communityBreach = {
  providerBreachId: "synthetic-community-2025",
  breachName: "Synthetic Community",
  breachDate: "2025-03-10",
  providerAddedAt: "2025-03-20T09:30:00.000Z",
  providerModifiedAt: "2025-03-21T09:30:00.000Z",
  dataCategories: ["Email addresses", "Geographic locations"],
  sourceUrl: "https://example.test/breaches/synthetic-community-2025",
  isVerified: true,
  isSensitive: false,
  isRetired: false,
} as const satisfies SyntheticBreachRecord;

export interface SyntheticFixturePage {
  readonly records: readonly unknown[];
  readonly nextCursor?: string;
}

export function syntheticFixturePage(
  scenario: SyntheticBreachScenario,
  cursor?: string,
): SyntheticFixturePage {
  if (scenario === "PAGINATED") {
    if (!cursor) return { records: [commerceBreach], nextCursor: "synthetic-page-2" };
    if (cursor === "synthetic-page-2") return { records: [communityBreach] };
    return { records: [], nextCursor: "invalid-cursor" };
  }

  if (cursor) return { records: [], nextCursor: "invalid-cursor" };

  switch (scenario) {
    case "SUCCESS":
    // A degraded provider still answers; only its self-reported health
    // differs, which is what makes a scan PARTIAL rather than COMPLETED.
    case "DEGRADED":
      return { records: [commerceBreach] };
    case "EMPTY":
      return { records: [] };
    case "DUPLICATE":
      return { records: [commerceBreach, commerceBreach] };
    case "MALFORMED":
      return { records: [{ ...commerceBreach, breachDate: "not-a-date" }] };
    case "HOSTILE":
      return {
        records: [{ ...commerceBreach, breachName: "<script>synthetic</script>" }],
      };
    case "SCHEMA_CHANGE":
      return { records: [{ ...commerceBreach, newProviderField: "synthetic-change" }] };
    case "TIMEOUT":
    case "AUTHENTICATION":
    case "RATE_LIMIT":
    case "OUTAGE":
      return { records: [] };
  }
}
