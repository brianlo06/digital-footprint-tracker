import { findAccount } from "@/core/account-service";
import { redirect } from "next/navigation";

import { deleteAccountAction } from "./actions";
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
  const managedAuthentication = process.env.AUTH_MODE === "clerk";

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Settings</p>
        <h1>Privacy controls</h1>
        <p className="lede">
          The current foundation stores account metadata, encrypted identifiers, verification state,
          consent, and privacy-safe audit events. No footprint findings exist yet.
        </p>
      </header>

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
        {parameters.error ? (
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
