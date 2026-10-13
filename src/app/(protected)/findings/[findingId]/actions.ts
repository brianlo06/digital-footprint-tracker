"use server";

import { findAccount } from "@/core/account-service";
import { isFindingReviewDecision } from "@/core/finding-review";
import { isFindingId, reviewFinding } from "@/core/finding-review-service";
import { requirePrincipal } from "@/security/auth";
import { redirect } from "next/navigation";

export async function reviewFindingAction(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const findingId = formData.get("findingId");
  const decision = formData.get("decision");
  // The ID is validated before it is used in a redirect target.
  if (!isFindingId(findingId)) redirect("/history?error=finding_unavailable");
  if (!isFindingReviewDecision(decision)) redirect(`/findings/${findingId}?review=invalid`);

  try {
    const account = await findAccount(principal);
    if (!account) redirect("/onboarding");
    const result = await reviewFinding(account, findingId, decision);
    if (result.outcome === "NOT_FOUND") redirect("/history?error=finding_unavailable");
    redirect(
      `/findings/${findingId}?review=${result.outcome === "UPDATED" ? "saved" : "unchanged"}`,
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/findings/${findingId}?review=failed`);
  }
}
