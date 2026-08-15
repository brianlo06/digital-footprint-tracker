# Route and Server Action Authorization Matrix

**Status:** Active Phase 1 foundation plus synthetic-only Phase 2 consent boundary

**Scope:** Current account, email-identifier, verification, breach-consent, and deletion foundation only

Every Server Action is treated as a directly reachable mutation endpoint. Layout checks improve navigation behavior but are not an authorization boundary. Leaf pages and data-access services re-check the current principal near protected data. Rate-limited actions consume database-atomic user and network limits; throttling is defense in depth, not authorization.

## Routes

| Route               | Required boundary                                      | No active account                     | Authorized data returned                                                         |
| ------------------- | ------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------- |
| `/`                 | Public; no private query                               | Public foundation page                | No account data                                                                  |
| `/onboarding`       | Current authenticated principal in the leaf page       | Show explicit account-creation action | No identifier data                                                               |
| `/dashboard`        | Current principal plus active account in the leaf page | Redirect to onboarding                | Counts from only the current account identity                                    |
| `/identities`       | Current principal plus active account in the leaf page | Redirect to onboarding                | Masked identifier DTOs for only the current identity                             |
| `/settings/privacy` | Current principal plus active account in the leaf page | Redirect to onboarding                | Purpose-specific consent state and generic policy text; no plaintext identifiers |
| `/deleted`          | Public receipt display                                 | Display supplied opaque receipt ID    | No lookup or enumeration; no deleted identifier detail                           |

The shared protected layout also checks authentication, but no leaf page relies on that check alone. There are no Route Handlers in the current foundation.

## Server Actions

| Action                        | Authentication and authorization                                                    | Untrusted input validation                     | Denial behavior                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `initializeAccountAction`     | Current authenticated principal; creates only that subject's account                | No client identity/user ID accepted            | Unauthenticated request fails; pending deletion is denied               |
| `addEmailAction`              | Current principal must already own an active account and identity                   | Consent flag plus normalized email             | Redirects to onboarding/error; never creates implicitly                 |
| `verifyEmailAction`           | Current active account; verification query joins through the owned identity         | Opaque verification ID plus six-digit code     | Cross-account IDs are indistinguishable from unavailable                |
| `grantBreachConsentAction`    | Current principal plus exact active account/identity; one active grant per policy   | Exact checkbox; no client resource ID          | Missing account redirects; invalid/failed grant changes nothing         |
| `withdrawBreachConsentAction` | Current principal; service derives only that account's active current-policy grant  | No client resource ID accepted                 | Missing grant is an idempotent no-op; cross-tenant rows are unreachable |
| `deleteAccountAction`         | Current principal; deletion resolves the user by authenticated subject; reauth gate | Exact `DELETE` confirmation; no client user ID | Clerk remains fail-closed; wrong confirmation changes nothing           |

## Automated negative coverage

- Direct identifier-action invocation cannot bypass explicit onboarding.
- A second account cannot consume or increment another account's verification challenge.
- A second account cannot withdraw another account's breach permission; withdrawal accepts no target ID.
- Concurrent breach-permission grants create one active record and one audit transition; concurrent withdrawal updates it once.
- Deleting one authenticated account leaves a different account intact.
- Service tests additionally cover cross-account list denial, five-attempt atomic lockout, reauthentication denial, and deletion-pending quarantine.
- Concurrent integration tests verify exact user/network thresholds, function-only limiter authority, and absence of raw subject/network values in limiter rows.

## Rules for future endpoints

1. Do not accept `userId`, `identityId`, or tenant context from browser input.
2. Resolve the current principal on every leaf page, Server Action, and Route Handler that reads or mutates private state.
3. Resolve resources through ownership joins in the data-access layer; an opaque ID alone is never authorization.
4. Return minimal DTOs and generic denial states that do not reveal cross-tenant existence.
5. Add the new boundary and its unauthenticated, uninitialized, owner, cross-tenant, deleted, and deletion-pending cases to this matrix before merge.
6. Provider, worker, maintenance, and support paths require separate service identities and capability-scoped policies; they must never reuse an end-user context.
