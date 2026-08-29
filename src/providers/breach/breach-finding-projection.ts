import type { CandidateFinding } from "@/core/domain.types";
import { normalizeHost } from "@/core/finding-fingerprint";
import type { ProjectedCandidate } from "@/core/postgres-finding-projection";

/**
 * Maps normalized breach candidates onto the generic temporal model's input.
 * Pure and persistence-free: identity comes from the provider's stable breach
 * ID and the source host, never from a mutable title or description.
 */
export function projectedCandidatesFromBreachResults(
  candidates: readonly CandidateFinding[],
): ProjectedCandidate[] {
  return candidates.map((candidate) => {
    const evidence = candidate.evidence[0];
    if (!evidence?.providerExternalId || !evidence.sourceUrl || !evidence.sourceDate) {
      throw new Error("BREACH_PROJECTION_EVIDENCE_INCOMPLETE");
    }
    return {
      findingType: "BREACH",
      title: candidate.title,
      normalizedHost: normalizeHost(evidence.sourceUrl),
      providerExternalId: evidence.providerExternalId,
      sourceDate: evidence.sourceDate,
      // Everything a user would notice changing about the same breach.
      contentFields: [
        candidate.title,
        evidence.sourceDate,
        [...(evidence.dataCategories ?? [])].sort().join(","),
        String(evidence.isVerified ?? false),
        String(evidence.isSensitive ?? false),
        String(evidence.isRetired ?? false),
      ],
    } satisfies ProjectedCandidate;
  });
}
