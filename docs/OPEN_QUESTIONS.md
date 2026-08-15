# Open Questions and Recommended Defaults

These do not block Phase 0. Defaults are intended to preserve safety and simplicity.

## Product

- Who is the first launch persona and jurisdiction? **Phase 2 decision:** one adult in the US monitoring only their own recently verified email. This is an engineering evaluation boundary; external launch still requires state-specific counsel review.
- Is the primary value breach awareness, public-web discovery, or remediation? **Default:** evidence review/remediation; validate before provider purchase.
- What coverage claim is acceptable? **Default:** no comprehensiveness claim; show enabled-source coverage.
- Is an overall score required? **Default:** no; category posture only.
- Will family/minor accounts exist? **Default:** no; requires separate authority/safety design.

## Architecture

- Which ORM after a small spike: Drizzle or Prisma? **Decision:** Drizzle for explicit schema/SQL and a thin persistence layer; revisit only with measured shortcomings.
- Which Node-compatible host/database region? **Default:** decide after jurisdiction and persistent-worker needs.
- Does Phase 2 need a separate worker deploy? **Default:** yes if any external call can outlive request bounds, same repository.
- What measured threshold triggers Redis/managed queue? **Default:** DB contention/lag, not user count alone.

## Privacy

- Exact retention choices and user controls? **Default:** policy in `PRIVACY.md`; offer shorter history.
- Per-record or per-tenant data keys? **Default:** design spike with KMS cost/blast-radius test.
- Are usernames always encrypted? **Default:** yes until a field-specific threat review says otherwise.
- Which subprocessors/regions are acceptable? **Default:** minimum number, contractual deletion/no-training, chosen launch region.

## Security

- Which managed auth product meets passkey/MFA, privacy, export, deletion, and cost needs? **Current direction:** Clerk adapter selected, pending isolated preview review of MFA/passkeys, recovery, deletion, privacy/DPA, portability, and stable destructive-action reauthentication; local development remains vendor-free.
- Will PostgreSQL RLS supplement application authorization? **Default:** evaluate as defense in depth, not sole control.
- What operator access exists? **Default:** no identifier plaintext in normal support; JIT audited break-glass only.
- What ASVS level? **Default:** map ASVS L2-style controls for sensitive-data application, with targeted higher controls.

## Legal

- Launch entities/jurisdictions and lawful bases? **Default:** counsel before production; feature/jurisdiction gates.
- Are opt-out instructions or submissions “authorized agent” activity? **Default:** assisted user action only until counsel decides.
- Which public records/data categories are categorically excluded? **Default:** government IDs, minors, relatives, precise location, eligibility/background use.
- What incident and data-subject response timelines apply? **Default:** map after jurisdiction/controller analysis.

## Provider

- What is the first low-risk provider? **Phase 2 readiness decision:** HIBP is the conditional preferred provider for verified-email breach metadata; synthetic use only until written customer-facing commercial permission is confirmed. See `PHASE_2_READINESS.md`.
- Is any general search provider worth query privacy and false positives? **Default:** defer beyond first provider.
- May results be cached/displayed and for how long? **Default:** no raw caching until contract says so.
- Is a broker partner necessary? **Default:** manual links/instructions; defer commercial partner.

## Business

- Hobby/private tool or commercial service? **Default:** architecture supports either, but legal/ops controls assume possible productization.
- Free limits and paid plans? **Default:** no pricing until provider unit economics are measured.
- Support model and security contact? **Default:** define before external users.
- Budget ceiling? **Phase 2 readiness decision:** USD 0 for live-provider daily/monthly spend and zero non-synthetic calls until compatible terms and a quote receive separate owner approval. Synthetic HIBP test endpoints remain permitted.

## UX

- What language communicates risk without fear? **Default:** categories + evidence + next action + uncertainty.
- How much identifier plaintext is visible? **Default:** masked; reveal after reauthentication only when necessary.
- How are partial scans compared historically? **Default:** do not compare totals without equivalent coverage; show caveat.
- Mobile/PWA? **Default:** responsive web, no install/offline/push MVP.
