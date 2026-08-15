import { findAccount } from "@/core/account-service";
import { listIdentifiers } from "@/core/identifier-service";
import { getBreachConsentSummary } from "@/privacy/breach-consent-service";
import { redirect } from "next/navigation";

import {
  deleteAccountAction,
  grantBreachConsentAction,
  withdrawBreachConsentAction,
} from "./actions";
import { ManagedDeleteForm } from "./managed-delete-form";
import { requireProtectedPagePrincipal } from "../../principal";

export const metadata = { title: "Privacy settings" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PrivacySettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const parameters = await searchParams;
  const account = await findAccount(await requireProtectedPagePrincipal());
  if (!account) redirect("/onboarding");
  const [breachConsent, identifierList] = await Promise.all([
    getBreachConsentSummary(account),
    listIdentifiers(account),
  ]);
  const breachConsentGranted = breachConsent?.state === "GRANTED";
  const hasVerifiedEmail = identifierList.some(
    (identifier) => identifier.verificationStatus === "VERIFIED",
  );
  const managedAuthentication = process.env.AUTH_MODE === "clerk";

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Settings</p>
        <h1>Privacy controls</h1>
        <p className="lede">
          Control why encrypted identifiers may be used. Synthetic provider work remains
          user-triggered, and no footprint findings exist yet.
        </p>
      </header>

      {parameters.consent === "granted" ? (
        <div className="notice" role="status">
          Breach-metadata permission recorded. This did not start a lookup.
        </div>
      ) : null}
      {parameters.consent === "withdrawn" ? (
        <div className="notice" role="status">
          Breach-metadata permission withdrawn. Future lookups are blocked immediately.
        </div>
      ) : null}
      {parameters.error === "breach_consent_required" ? (
        <div className="notice danger" role="alert">
          Confirm the purpose-specific permission before granting it.
        </div>
      ) : parameters.error === "breach_consent_update_failed" ? (
        <div className="notice danger" role="alert">
          The consent update could not be completed. No provider lookup was started.
        </div>
      ) : null}

      <section aria-labelledby="breach-consent-heading" className="card">
        <h2 id="breach-consent-heading">Breach-metadata permission</h2>
        <p>
          This permission covers sending a recently verified email reference through the approved
          breach-metadata lookup boundary and processing returned breach names, dates, and data
          categories. It does not permit passwords, credential artifacts, raw breach dumps,
          continuous monitoring, or unrelated provider use.
        </p>
        <p className="muted">
          Policy phase2-breach-v1 · current state:{" "}
          {breachConsentGranted ? "granted" : "not granted"}
          {breachConsent?.grantedAt
            ? ` · granted ${breachConsent.grantedAt.toLocaleDateString()}`
            : ""}
        </p>
        {!hasVerifiedEmail ? (
          <div className="notice">
            No verified email is currently eligible. Permission alone never authorizes a lookup;
            verification and all runtime safety gates must also pass.
          </div>
        ) : null}
        {breachConsentGranted ? (
          <form action={withdrawBreachConsentAction} className="form-grid">
            <p className="muted">
              Withdrawal prevents future provider dispatch immediately. Existing account data still
              follows the retention and deletion controls below.
            </p>
            <button className="danger" type="submit">
              Withdraw breach-metadata permission
            </button>
          </form>
        ) : (
          <form action={grantBreachConsentAction} className="form-grid">
            <label className="checkbox-row">
              <input name="consent" required type="checkbox" />
              <span>
                I permit use of my verified email for user-triggered breach-metadata lookups under
                policy phase2-breach-v1. I understand this records permission but starts no lookup.
              </span>
            </label>
            <button type="submit">Grant breach-metadata permission</button>
          </form>
        )}
      </section>

      <section className="card">
        <h2>Current retention</h2>
        <p>
          Identifier data remains until you delete the account. Verification challenges expire after
          15 minutes. No provider response, scan history, notification, or raw web content is
          currently collected.
        </p>
      </section>

      <section className="card">
        <h2>How identifiers are protected</h2>
        <p>
          Values use a per-record random data key and AES-256-GCM. The data key is wrapped by the
          configured application key. Equality checks use a separate keyed token.
        </p>
      </section>

      <section aria-labelledby="delete-heading" className="card">
        <h2 id="delete-heading">Delete account data</h2>
        <div className="notice danger">
          This deletes identifiers, verification records, consent, and linked audit ownership. A
          pseudonymous deletion receipt is retained for a limited period.
        </div>
        {parameters.error && !String(parameters.error).startsWith("breach_consent") ? (
          <p role="alert">Deletion was not completed. Confirm the text or retry safely.</p>
        ) : null}
        {managedAuthentication ? (
          <ManagedDeleteForm />
        ) : (
          <form action={deleteAccountAction} className="form-grid">
            <label>
              Type DELETE to confirm
              <input autoComplete="off" name="confirmation" required type="text" />
            </label>
            <button className="danger" type="submit">
              Delete my account data
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
