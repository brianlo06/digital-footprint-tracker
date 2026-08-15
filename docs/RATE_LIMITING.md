# Protected Action Rate Limiting

## Scope

Every current protected mutation consumes both a per-user and shared-network limit before validating form data:

| Action               | User limit | Network limit | Window     | Block      |
| -------------------- | ---------: | ------------: | ---------- | ---------- |
| Account onboarding   |          5 |            20 | 1 hour     | 1 hour     |
| Add email identifier |         10 |            30 | 1 hour     | 1 hour     |
| Verification attempt |         20 |            60 | 15 minutes | 30 minutes |
| Account deletion     |          5 |            20 | 1 hour     | 1 hour     |

The per-verification-record five-attempt lockout remains independent and stricter than the general verification-action limit.

## Privacy and database authority

Authentication subjects and network addresses are converted to separate HMAC-SHA-256 lookup tokens before persistence. The database stores only scope kind, keyed token, action, window/count state, block expiry, and retention expiry. Raw IP addresses and authentication subjects are never written to the limiter table or returned by its function.

`rate_limit_windows` has forced RLS and no tenant policy, so ordinary direct access fails closed. The web runtime has no table grant and may execute only `consume_action_rate_limit`. That function is owned by a narrowly granted non-login role that remains `NOBYPASSRLS` and is named by an exact fixed-role capability policy. Limits are fixed inside PostgreSQL rather than supplied by callers, and one atomic upsert serializes concurrent attempts for each scope/action.

Expired limiter state is removed by bounded retention maintenance. Lookup-key rotation intentionally starts new pseudonymous scopes; treat that as part of the documented rotation procedure.

## Trusted network source

Local development intentionally maps all requests to one synthetic network. Outside local mode, protected mutations fail closed unless `TRUSTED_CLIENT_IP_HEADER` names a single-value IP header that the selected ingress strips and rewrites. Do not configure an end-user-controlled header or pass an arbitrary `X-Forwarded-For` chain.

Before hosted preview, verify the ingress behavior directly, test shared-network false positives, calibrate limits with synthetic traffic, and define user-facing retry/support behavior. Network signals are defense in depth and must never independently trigger an accusation or adverse account decision.
