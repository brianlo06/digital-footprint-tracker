"use server";

import { getServerEnv } from "@/config/server-env";
import { findAccount } from "@/core/account-service";
import { SYNTHETIC_BREACH_SCAN_BUDGET } from "@/providers/breach/breach-scan-service";
import { executePostgresSyntheticBreachScan } from "@/providers/breach/postgres-breach-scan";
import { selectBreachProviderFromEnv } from "@/providers/provider-registry";
import { requirePrincipal } from "@/security/auth";
import { consumeServerActionRateLimit } from "@/security/rate-limit";
import { redirect } from "next/navigation";

export async function runBreachScanAction(): Promise<void> {
  const principal = await requirePrincipal();
  const rateLimit = await consumeServerActionRateLimit(principal, "BREACH_SCAN");
  if (!rateLimit.allowed) redirect("/dashboard?scan=rate_limited");

  try {
    const account = await findAccount(principal);
    if (!account) redirect("/onboarding");

    const providerSelection = selectBreachProviderFromEnv(getServerEnv());
    const result = await executePostgresSyntheticBreachScan({
      account,
      now: new Date(),
      providerSelection,
      usageBudget: SYNTHETIC_BREACH_SCAN_BUDGET,
    });
    redirect(`/dashboard?scan=${result.status.toLowerCase()}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/dashboard?scan=failed");
  }
}
