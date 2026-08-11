import { findAccount } from "@/core/account-service";
import { listIdentifiers } from "@/core/identifier-service";
import { requirePrincipal } from "@/security/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata = { title: "Privacy overview" };

export default async function DashboardPage() {
  const account = await findAccount(await requirePrincipal());
  if (!account) redirect("/onboarding");
  const identifierList = await listIdentifiers(account);
  const verified = identifierList.filter((item) => item.verificationStatus === "VERIFIED").length;

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Foundation status</p>
        <h1>Privacy overview</h1>
        <p className="lede">
          Your private foundation is ready. Footprint findings and scanning are intentionally not
          part of this milestone.
        </p>
      </header>
      <div className="grid">
        <article className="card">
          <p className="eyebrow">Identifiers</p>
          <h2>{identifierList.length}</h2>
          <p className="muted">Stored with application-level encryption.</p>
        </article>
        <article className="card">
          <p className="eyebrow">Verified</p>
          <h2>{verified}</h2>
          <p className="muted">Eligible for future capabilities only after separate approval.</p>
        </article>
        <article className="card">
          <p className="eyebrow">External providers</p>
          <h2>0</h2>
          <p className="muted">No search, breach, broker, social, or domain source is active.</p>
        </article>
      </div>
      <div className="status-panel">
        <h2>Next safe step</h2>
        <p>
          Add and verify a synthetic or personal email locally. It will not be transmitted to an
          email service or scanning provider.
        </p>
        <Link className="button" href="/identities">
          Manage identifiers
        </Link>
      </div>
    </div>
  );
}
