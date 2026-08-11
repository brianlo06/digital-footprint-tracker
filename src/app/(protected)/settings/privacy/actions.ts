"use server";

import { deleteAccount } from "@/privacy/deletion-service";
import { getAuthGateway, requirePrincipal } from "@/security/auth";
import { consumeServerActionRateLimit } from "@/security/rate-limit";
import { redirect } from "next/navigation";

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const rateLimit = await consumeServerActionRateLimit(principal, "ACCOUNT_DELETE");
  if (!rateLimit.allowed) redirect("/settings/privacy?error=rate_limited");
  if (formData.get("confirmation") !== "DELETE") {
    redirect("/settings/privacy?error=confirmation");
  }

  try {
    if (principal.mode === "clerk") {
      redirect("/settings/privacy?error=reauthentication_required");
    }

    // Local mode is non-production and has no external credential to reauthenticate.
    const result = await deleteAccount(principal, getAuthGateway(), {
      recentlyReauthenticated: true,
    });
    redirect(`/deleted?receipt=${encodeURIComponent(result.receiptId)}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/settings/privacy?error=deletion_failed");
  }
}
