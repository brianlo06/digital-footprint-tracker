"use client";

import { useReverification } from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { deleteManagedAccountAction } from "./actions";

type FormError = "confirmation" | "rate_limited" | "deletion_failed" | "cancelled";

const errorMessages: Record<FormError, string> = {
  confirmation: "Type DELETE exactly to confirm account deletion.",
  rate_limited: "Too many deletion attempts. Wait a while before retrying.",
  deletion_failed: "Deletion was not completed. Your account remains protected; retry safely.",
  cancelled: "Reauthentication was cancelled. No data was changed.",
};

export function ManagedDeleteForm() {
  const router = useRouter();
  const deleteWithReverification = useReverification(deleteManagedAccountAction);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    try {
      const result = await deleteWithReverification(new FormData(event.currentTarget));
      if (result.status === "deleted") {
        router.push(`/deleted?receipt=${encodeURIComponent(result.receiptId)}`);
        return;
      }
      setError(result.code);
    } catch (caught) {
      setError(isReverificationCancelledError(caught) ? "cancelled" : "deletion_failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        Type DELETE to confirm
        <input autoComplete="off" disabled={pending} name="confirmation" required type="text" />
      </label>
      {error ? <p role="alert">{errorMessages[error]}</p> : null}
      <button className="danger" disabled={pending} type="submit">
        {pending ? "Confirming securely…" : "Delete my account data"}
      </button>
      <p className="muted">
        Before deletion, you will be asked to confirm your strongest available sign-in factor.
      </p>
    </form>
  );
}
