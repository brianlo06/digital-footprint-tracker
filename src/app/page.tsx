import Link from "next/link";

export default function HomePage() {
  const previewOnly = process.env.AUTH_MODE === "disabled";

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Private by design · Self-monitoring only</p>
        <h1>Know what the public web says about you.</h1>
        <p className="lede">
          Digital Footprint Tracker is being built to turn scattered online exposure into clear,
          explainable evidence and safer next steps. The local demo now connects encrypted
          identifiers, explicit consent, queued synthetic scans, and finding history. All results
          are fictional.
        </p>
        {previewOnly ? (
          <div className="notice warning" role="status">
            This hosted preview demonstrates the public foundation only. Authentication,
            identifiers, and all personal-data features remain disabled until their hosted security
            gates are complete.
          </div>
        ) : null}
        <div className="actions">
          <Link className="button" href={previewOnly ? "/preview" : "/onboarding"}>
            {previewOnly ? "Review preview boundary" : "Start local demo"}
          </Link>
          <Link
            className="button secondary"
            href={previewOnly ? "#foundation-heading" : "/settings/privacy"}
          >
            {previewOnly ? "Explore the foundation" : "Review privacy controls"}
          </Link>
        </div>
      </section>
      <section aria-labelledby="foundation-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Current foundation</p>
            <h2 id="foundation-heading">Built around restraint</h2>
          </div>
        </div>
        <div className="grid">
          <article className="card">
            <h3>Encrypted identifiers</h3>
            <p className="muted">
              Email values are encrypted before database storage and never written to logs.
            </p>
          </article>
          <article className="card">
            <h3>Explicit verification</h3>
            <p className="muted">
              Authentication and control of an identifier are treated as separate proofs.
            </p>
          </article>
          <article className="card">
            <h3>No live provider calls</h3>
            <p className="muted">
              Live integrations remain disabled. The local synthetic adapter uses fictional fixtures
              with no network client.
            </p>
          </article>
        </div>
      </section>
    </>
  );
}
