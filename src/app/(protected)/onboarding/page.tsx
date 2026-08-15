import { findAccount } from "@/core/account-service";
import { redirect } from "next/navigation";

import { initializeAccountAction } from "./actions";
import { requireProtectedPagePrincipal } from "../principal";

export const metadata = { title: "Set up account" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  const parameters = await searchParams;
  const existingAccount = await findAccount(await requireProtectedPagePrincipal());
  if (existingAccount) redirect("/dashboard");

  return (
    <div className="stack narrow">
      <header>
        <p className="eyebrow">Private foundation</p>
        <h1>Set up your account</h1>
        <p className="lede">
          This creates an internal identity container linked to your authenticated account. It does
          not add identifiers, start scans, contact providers, or authorize future monitoring.
        </p>
      </header>
      {parameters.error === "rate_limited" ? (
        <div className="notice danger" role="alert">
          Too many setup attempts were received. Wait before trying again.
        </div>
      ) : null}
      <section className="card">
        <h2>What will be stored</h2>
        <p>
          An opaque authentication subject, internal account and identity IDs, and a privacy-safe
          audit event. You can delete this foundation from Privacy settings.
        </p>
        <form action={initializeAccountAction}>
          <button type="submit">Create private foundation</button>
        </form>
      </section>
    </div>
  );
}
