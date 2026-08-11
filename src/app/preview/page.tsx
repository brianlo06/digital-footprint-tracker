import Link from "next/link";

export default function PreviewBoundaryPage() {
  return (
    <section className="stack" aria-labelledby="preview-heading">
      <div>
        <p className="eyebrow">Hosted preview</p>
        <h1 id="preview-heading">The safety boundary is active.</h1>
        <p className="lede">
          This deployment exposes the public product foundation for review. Authentication and every
          feature that could store or process personal identifiers remain disabled.
        </p>
      </div>

      <div className="notice warning">
        Dashboard, onboarding, identifier verification, account deletion, scanning, providers,
        notifications, and scheduled work are unavailable in this preview.
      </div>

      <div className="grid">
        <article className="card">
          <h2>No personal data</h2>
          <p className="muted">
            The Worker has no database, authentication-provider, encryption-key, or delivery
            credentials.
          </p>
        </article>
        <article className="card">
          <h2>No external discovery</h2>
          <p className="muted">
            Search, breach, broker, social, domain, and notification integrations remain absent.
          </p>
        </article>
        <article className="card">
          <h2>Fail-closed routes</h2>
          <p className="muted">
            Protected routes redirect here, while direct mutation attempts are rejected as
            unauthenticated.
          </p>
        </article>
      </div>

      <div className="actions">
        <Link className="button" href="/">
          Return home
        </Link>
      </div>
    </section>
  );
}
