"use server";

import { createAccountIfMissing } from "@/core/account-service";
import { requirePrincipal } from "@/security/auth";
import { consumeServerActionRateLimit } from "@/security/rate-limit";
import { redirect } from "next/navigation";

export async function initializeAccountAction(): Promise<void> {
  const principal = await requirePrincipal();
  const rateLimit = await consumeServerActionRateLimit(principal, "ONBOARDING");
  if (!rateLimit.allowed) redirect("/onboarding?error=rate_limited");
  await createAccountIfMissing(principal);
  redirect("/dashboard");
}
