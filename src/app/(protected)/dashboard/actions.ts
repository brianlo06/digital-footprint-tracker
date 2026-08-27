"use server";

import { getServerEnv } from "@/config/server-env";
import { findAccount } from "@/core/account-service";
import {
  cancelQueuedPostgresBreachScan,
  enqueuePostgresSyntheticBreachScan,
} from "@/providers/breach/breach-scan-queue";
import { dispatchQueuedPostgresSyntheticBreachScan } from "@/providers/breach/postgres-breach-scan-job";
import { selectBreachProviderFromEnv } from "@/providers/provider-registry";
import { requirePrincipal } from "@/security/auth";
import { logSafeEvent } from "@/security/logger";
import { consumeServerActionRateLimit } from "@/security/rate-limit";
import { redirect } from "next/navigation";
import { after } from "next/server";

export async function runBreachScanAction(): Promise<void> {
  const principal = await requirePrincipal();
  const rateLimit = await consumeServerActionRateLimit(principal, "BREACH_SCAN");
  if (!rateLimit.allowed) redirect("/dashboard?scan=rate_limited");

  try {
    const account = await findAccount(principal);
    if (!account) redirect("/onboarding");

    const providerSelection = selectBreachProviderFromEnv(getServerEnv());
    const result = await enqueuePostgresSyntheticBreachScan({
      account,
      providerSelection,
    });
    if ("scanId" in result) {
      after(async () => {
        try {
          const outcome = await dispatchQueuedPostgresSyntheticBreachScan({
            account,
            scanId: result.scanId,
            now: new Date(),
            providerSelection,
          });
          logSafeEvent({
            event: "BREACH_SCAN_JOB_DISPATCH",
            userId: account.userId,
            targetId: result.scanId,
            outcome,
          });
        } catch {
          logSafeEvent({
            event: "BREACH_SCAN_JOB_DISPATCH",
            userId: account.userId,
            targetId: result.scanId,
            outcome: "FAILED",
            errorCode: "SCAN_JOB_DISPATCH_FAILED",
          });
        }
      });
    }
    redirect(`/dashboard?scan=${result.status.toLowerCase()}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/dashboard?scan=failed");
  }
}

export async function cancelQueuedBreachScanAction(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const account = await findAccount(principal);
  if (!account) redirect("/onboarding");

  try {
    const scanId = formData.get("scanId");
    if (typeof scanId !== "string") redirect("/dashboard?scan=cancel_failed");
    const result = await cancelQueuedPostgresBreachScan(account, scanId);
    redirect(`/dashboard?scan=${result.toLowerCase()}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/dashboard?scan=cancel_failed");
  }
}
