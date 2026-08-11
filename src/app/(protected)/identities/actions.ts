"use server";

import { findAccount } from "@/core/account-service";
import { addEmailIdentifier, verifyEmailIdentifier } from "@/core/identifier-service";
import { requirePrincipal } from "@/security/auth";
import { consumeServerActionRateLimit } from "@/security/rate-limit";
import { redirect } from "next/navigation";

export async function addEmailAction(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const rateLimit = await consumeServerActionRateLimit(principal, "IDENTIFIER_ADD");
  if (!rateLimit.allowed) redirect("/identities?error=rate_limited");
  if (formData.get("consent") !== "on") redirect("/identities?error=consent_required");
  const email = formData.get("email");
  if (typeof email !== "string") redirect("/identities?error=invalid_email");

  try {
    const account = await findAccount(principal);
    if (!account) redirect("/onboarding");
    const result = await addEmailIdentifier(account, email);
    redirect(`/identities?added=1&verification=${encodeURIComponent(result.verificationId)}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/identities?error=add_failed");
  }
}

export async function verifyEmailAction(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  const rateLimit = await consumeServerActionRateLimit(principal, "VERIFICATION_ATTEMPT");
  if (!rateLimit.allowed) redirect("/identities?error=rate_limited");
  const verificationId = formData.get("verificationId");
  const code = formData.get("code");
  if (typeof verificationId !== "string" || typeof code !== "string" || !/^[0-9]{6}$/.test(code)) {
    redirect("/identities?error=verification_invalid");
  }

  try {
    const account = await findAccount(principal);
    if (!account) redirect("/onboarding");
    await verifyEmailIdentifier(account, verificationId, code);
    redirect("/identities?verified=1");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      `/identities?error=verification_failed&verification=${encodeURIComponent(verificationId)}`,
    );
  }
}
