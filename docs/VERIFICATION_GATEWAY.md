# Email Verification Gateway

## Current boundary

Identifier enrollment depends on `EmailVerificationGateway`, not on the local fixture directly. A gateway receives only the normalized destination and opaque verification ID, then returns the method, purpose-bound challenge hash, and expiry needed by the identifier service.

The only implementation is `LocalFakeEmailVerificationGateway`. It is hard-gated to local application and authentication modes, creates a fifteen-minute keyed challenge hash, does not retain the destination, and sends no message or network request.

## Production gate

No delivery provider is selected or authorized. Before adding one:

1. Complete provider legal/privacy/security/DPA and deliverability review.
2. Minimize message and provider metadata and document their retention.
3. Use idempotent delivery or a transactional outbox so database failure cannot create an untracked valid message.
4. Preserve generic responses, single-use verification, expiry, record-level attempt lockout, and distributed throttling.
5. Add provider contract tests for success, timeout, duplicate delivery, provider rejection, malformed response, and retry classification using synthetic destinations.
6. Keep the local implementation impossible to select in preview or production.

Adding the interface is not approval to send email.
