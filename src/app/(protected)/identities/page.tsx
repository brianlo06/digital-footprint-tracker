import { findAccount } from "@/core/account-service";
import { listIdentifiers } from "@/core/identifier-service";
import { isBreachVerificationRecent } from "@/providers/breach/breach-invocation-policy";
import Link from "next/link";
import { redirect } from "next/navigation";

import { addEmailAction, requestVerificationAction, verifyEmailAction } from "./actions";
import { requireProtectedPagePrincipal } from "../principal";

export const metadata = { title: "My identifiers" };

// Each message names the field or step at fault and how to recover, without
// revealing whether an identifier or challenge exists for another account.
const IDENTIFIER_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "Too many attempts were received. Wait a few minutes before trying again.",
  consent_required: "Tick the storage consent box before adding an email address.",
  invalid_email: "Enter an email address in the Email address field.",
  add_failed:
    "The email could not be added. Check that it is a valid address you have not already added, then try again.",
  verification_invalid: "Enter the six-digit verification code using digits only.",
  verification_failed:
    "That code was not accepted. Check the six digits and try again, or get a new code if it has expired or locked.",
  verification_request_failed: "A new code could not be issued for that identifier. Try again.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function IdentitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const parameters = await searchParams;
  const account = await findAccount(await requireProtectedPagePrincipal());
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
      {parameters.reissued ? (
        <div className="notice" role="status">
          A new verification code was issued and any earlier code no longer works. Complete the
          local-only verification step below.
        </div>
      ) : null}
      {parameters.verified ? (
        <div className="notice" role="status">
          Identifier verified locally.{" "}
          <Link href="/settings/privacy">Next: review breach-metadata permission</Link>.
        </div>
      ) : null}
      {typeof parameters.error === "string" ? (
        <div className="notice danger" role="alert">
          {IDENTIFIER_ERROR_MESSAGES[parameters.error] ??
            "The request could not be completed. Check the input and try again."}
        </div>
      ) : null}

      <section aria-labelledby="stored-identifiers" className="card">
        <h2 id="stored-identifiers">Stored identifiers</h2>
        {identifierList.length === 0 ? (
          <div className="empty-state">No identifiers are stored yet.</div>
        ) : (
          <div className="stack">
            {identifierList.map((identifier) => {
              const verifiedRecently =
                identifier.verificationStatus === "VERIFIED" &&
                isBreachVerificationRecent(identifier.lastVerifiedAt);
              return (
                <article className="identifier-row" key={identifier.id}>
                  <div>
                    <p>
                      <strong>{identifier.maskedDisplay}</strong>
                    </p>
                    <p className="muted">
                      Email · added {identifier.createdAt.toLocaleDateString()}
                      {identifier.lastVerifiedAt
                        ? ` · last verified ${identifier.lastVerifiedAt.toLocaleString()}`
                        : ""}
                    </p>
                    {identifier.verificationStatus === "VERIFIED" && !verifiedRecently ? (
                      <p className="muted">
                        Verified more than 24 hours ago. Verify again before running a check.
                      </p>
                    ) : null}
                  </div>
                  <div className="identifier-actions">
                    <span className="badge">{identifier.verificationStatus.toLowerCase()}</span>
                    {identifier.verificationStatus !== "REVOKED" ? (
                      <form action={requestVerificationAction}>
                        <input name="identifierId" type="hidden" value={identifier.id} />
                        <button className="button secondary" type="submit">
                          {identifier.verificationStatus === "VERIFIED"
                            ? "Verify again"
                            : "Get a new code"}
                          <span className="visually-hidden"> for {identifier.maskedDisplay}</span>
                        </button>
                      </form>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {verificationId ? (
        <section aria-labelledby="verify-heading" className="card">
          <h2 id="verify-heading">Verify locally</h2>
          <p className="muted">
            No message is sent in this demo. Use the local fixture code configured in your
            environment (the example value is 000000).
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
          Use a fictional address such as demo@example.test. The value is normalized in memory,
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
