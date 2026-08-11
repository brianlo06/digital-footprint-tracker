"use server";

import { deleteAccount } from "@/privacy/deletion-service";
import { getAuthGateway, requirePrincipal } from "@/security/auth";
import { evaluateStrictReverification } from "@/security/destructive-action-authorization";
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

export type ManagedDeletionResult =
  | { readonly status: "deleted"; readonly receiptId: string }
  | {
      readonly status: "error";
      readonly code: "confirmation" | "rate_limited" | "deletion_failed";
    };

export async function deleteManagedAccountAction(formData: FormData) {
  const principal = await requirePrincipal();
  if (principal.mode !== "clerk") {
    return { status: "error", code: "deletion_failed" } as const;
  }
  if (formData.get("confirmation") !== "DELETE") {
    return { status: "error", code: "confirmation" } as const;
  }

  const { auth, reverificationError } = await import("@clerk/nextjs/server");
  const currentAuth = await auth.protect();
  const authorization = evaluateStrictReverification(
    principal.subject,
    currentAuth.userId,
    currentAuth.has({ reverification: "strict" }),
  );
  if (authorization === "SUBJECT_MISMATCH") {
    return { status: "error", code: "deletion_failed" } as const;
  }
  if (authorization === "REVERIFICATION_REQUIRED") {
    return reverificationError("strict");
  }

  const rateLimit = await consumeServerActionRateLimit(principal, "ACCOUNT_DELETE");
  if (!rateLimit.allowed) {
    return { status: "error", code: "rate_limited" } as const;
  }

  try {
    const result = await deleteAccount(principal, getAuthGateway(), {
      recentlyReauthenticated: true,
    });
    return { status: "deleted", receiptId: result.receiptId } as const;
  } catch {
    return { status: "error", code: "deletion_failed" } as const;
  }
}
