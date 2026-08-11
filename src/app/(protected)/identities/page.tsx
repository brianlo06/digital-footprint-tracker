import { findAccount } from "@/core/account-service";
import { listIdentifiers } from "@/core/identifier-service";
import { requirePrincipal } from "@/security/auth";
import { redirect } from "next/navigation";

import { addEmailAction, verifyEmailAction } from "./actions";

export const metadata = { title: "My identifiers" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function IdentitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const parameters = await searchParams;
  const account = await findAccount(await requirePrincipal());
  if (!account) redirect("/onboarding");
  const identifierList = await listIdentifiers(account);
  const verificationId =
    typeof parameters.verification === "string" ? parameters.verification : undefined;

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">My identity</p>
        <h1>Identifiers</h1>
        <p className="lede">
          Identifiers are separate from your login account. Adding one does not start a scan or send
          it to an external provider.
        </p>
      </header>

      {parameters.added ? (
        <div className="notice" role="status">
          Email encrypted and stored. Complete the local-only verification step below.
        </div>
      ) : null}
      {parameters.verified ? (
        <div className="notice" role="status">
          Identifier verified locally. No provider capability has been enabled.
        </div>
      ) : null}
      {parameters.error ? (
        <div className="notice danger" role="alert">
          The request could not be completed. Check the input and try again.
        </div>
      ) : null}

      <section aria-labelledby="stored-identifiers" className="card">
        <h2 id="stored-identifiers">Stored identifiers</h2>
        {identifierList.length === 0 ? (
          <div className="empty-state">No identifiers are stored yet.</div>
        ) : (
          <div className="stack">
            {identifierList.map((identifier) => (
              <article className="identifier-row" key={identifier.id}>
                <div>
                  <p>
                    <strong>{identifier.maskedDisplay}</strong>
                  </p>
                  <p className="muted">Email · added {identifier.createdAt.toLocaleDateString()}</p>
                </div>
                <span className="badge">{identifier.verificationStatus.toLowerCase()}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      {verificationId ? (
        <section aria-labelledby="verify-heading" className="card">
          <h2 id="verify-heading">Verify locally</h2>
          <p className="muted">
            No message is sent in Phase 1. Use the local fixture code configured in your environment
            (the example value is 000000).
          </p>
          <form action={verifyEmailAction} className="form-grid">
            <input name="verificationId" type="hidden" value={verificationId} />
            <label>
              Six-digit verification code
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                name="code"
                pattern="[0-9]{6}"
                required
                type="text"
              />
            </label>
            <button type="submit">Verify identifier</button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="add-heading" className="card">
        <h2 id="add-heading">Add an email</h2>
        <p className="muted">
          For local evaluation, synthetic data is safest. The value is normalized in memory,
          envelope-encrypted, and represented by a keyed lookup token.
        </p>
        <form action={addEmailAction} className="form-grid">
          <label>
            Email address
            <input autoComplete="email" maxLength={254} name="email" required type="email" />
          </label>
          <label className="checkbox-row">
            <input name="consent" required type="checkbox" />
            <span>
              I consent to storing this email in encrypted form for identifier setup and
              verification. No scan or external provider use is authorized.
            </span>
          </label>
          <button type="submit">Encrypt and add email</button>
        </form>
      </section>
    </div>
  );
}
