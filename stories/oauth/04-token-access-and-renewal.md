# Expose usable tokens and silent renewal

## User Story

As a consuming app developer, I want a typed auth client that retrieves a usable bearer token, renews it with a refresh token, and starts interactive acquisition when needed so that API services can authenticate requests outside React components.

## Business Outcome

- A service module can call `getToken()`, `silentRenewToken()`, `getRefreshToken()`, and `acquireToken()` on the same client used by the provider.
- Expired tokens are not returned as usable; refresh rotation is handled without duplicate requests in one app instance.

## Domain Context

- **Bounded Context:** OAuth token lifecycle for a browser public client.
- **Primary Capability:** Expiry-aware token access and refresh-token renewal.
- **Existing Artifacts Involved:** `TokenStorage`, `OauthResponse.renewAccessToken`, token response types, `AuthClient`, provider context and hooks.
- **New or Updated Artifacts Likely Needed:** `TokenService`, typed token/renewal outcomes, explicit auth status, refresh-in-flight coordination.

## Codebase Evidence

- `src/lib/services/token/tokenService.ts` - currently an empty stub, removed by story 1 and replaced here with the real service.
- `src/lib/services/oauth-response/OauthResponse.ts` - refresh posts `FormData` without `client_id`, catches network errors silently, and returns no new access token.
- `src/lib/services/token-storage/TokenStorage.ts` - has an expiration key but does not derive or check expiry from token responses.
- `src/lib/index.ts` - exposes storage directly but no cohesive token lifecycle API for services outside React.

## File Touch Plan

| Path | Change | Reason |
| --- | --- | --- |
| `src/lib/services/token/tokenService.ts`, `src/lib/services/token/tokenService.test.ts` | create | Implement expiry-aware token retrieval and renewal coordination with typed outcomes. |
| `src/lib/services/oauth-response/OauthResponse.ts`, `src/lib/services/oauth-response/OauthResponse.test.ts` | update | Send standards-compatible refresh requests, validate responses, save rotation, and surface failures. |
| `src/lib/services/token-storage/TokenStorage.ts`, `src/lib/services/token-storage/TokenStorage.test.ts` | update | Read/write a complete token record; clear invalid grants and support cross-tab change observation. |
| `src/lib/types/response.type.ts`, `src/lib/types/config.type.ts` | update | Define token record, expiry skew, refresh result, and error types without assuming JWT access tokens. |
| `src/lib/services/auth-client/AuthClient.ts`, `src/lib/services/auth-client/AuthClient.test.ts` | update | Expose `getToken`, `getRefreshToken`, `silentRenewToken`, and `acquireToken` to non-React callers. |
| `src/lib/components/auth-provider/ReactAuthProvider.tsx`, `src/lib/context/AuthContext.tsx`, `src/lib/index.ts` | update/verify | Expose the same stable client and auth status through context/hook and package exports. |
| `src/lib/components/login-page/LoginPage.tsx`, `src/lib/components/login-page/LoginPage.test.tsx` | update | An already authenticated user who lands on `/login` is sent to a safe internal page without a new authorization request. |
| `src/App.tsx` | update | Exercise a protected fetch using `Authorization: Bearer <token>` and show expiry/refresh status. |

## Technical Implementation Plan

### Vertical Slice Summary

A consumer service asks the shared `AuthClient` for an unexpired access token. If none exists, it can attempt refresh without leaving the page. If refresh is unavailable or denied, it calls `acquireToken` and returns control while the browser navigates to the login stage. A local demo request displays the resulting auth state.

### Entry Points and Orchestration

`getToken(): Promise<string | null>` returns only a token still usable after a small expiry skew. `getRefreshToken(): Promise<string | null>` exposes the stored refresh token explicitly. `silentRenewToken(): Promise<string | null>` performs a refresh grant and returns the new access token or `null` for no refresh token/terminal authorization failure; network failures surface as typed errors. `acquireToken({ returnTo? })` begins interactive navigation and must be documented as an action that does not synchronously produce a token. Provider status and `useAuth(authClient)` reflect refresh and logout transitions. The proposed consumer status includes `initializing`, `anonymous`, and `authenticated`; expose renewal progress separately so an authenticated user does not appear anonymous during refresh.

### Domain and Application Changes

Use the token endpoint with a URL-encoded `grant_type=refresh_token` request, `refresh_token`, and `client_id` for a public client where required. Recompute expiry from each success response, accept an absent new refresh token only when the provider permits reuse, and atomically replace a rotated token when one is returned. Update granted scopes when the response includes `scope`; preserve the existing grant when the response omits it. Coalesce concurrent refresh calls for the same client in the current runtime. Re-read storage before acting on another tab's changes, and document remaining multi-tab rotation limits; add Web Locks coordination if browser support and the demo provider make it practical without a package.

### API, UI, Output, or Infrastructure Changes

Export `AuthClient` creation/access and the token methods from `src/lib/index.ts`. Let services outside React import the configured client; let components use the same client through `useAuth`. The demo's protected request uses the HTTP `Authorization` header and the `Bearer` scheme. Show meaningful auth status but keep API-specific HTTP calls owned by the consumer.

### Data, Contracts, and Edge Cases

For this release, token validation is **expiry and refresh eligibility**, as requested. Access tokens may be opaque; parsing a JWT string or checking an unverified signature is not a local security decision. Respect `expires_in`, clock skew, missing refresh tokens, rotated refresh tokens, provider `invalid_grant`, non-Bearer token types, malformed JSON, storage changes, and network failures. Never treat a failed refresh as success or keep serving a known-expired token. The resource server remains responsible for enforcing token validity.

### Testing and Validation Plan

- `src/lib/services/token/tokenService.test.ts` - valid, near-expiry, expired, malformed, and missing records; same-client parallel refresh coalescing.
- `src/lib/services/oauth-response/OauthResponse.test.ts` - URL-encoded refresh request, refresh rotation, updated/omitted scopes, no replacement refresh token, HTTP/OAuth/network failures, and client ID.
- `src/lib/services/auth-client/AuthClient.test.ts` - outside-React access matches provider state; `acquireToken` starts navigation without returning a token.
- `src/lib/components/login-page/LoginPage.test.tsx` - Back/direct navigation to login while authenticated redirects safely and starts no PKCE flow.
- Validation commands: `npm run build`, `npm run test:deploy`, and the local demo's protected-request flow.

## Dependency & Package Requirements

No new packages required. Browser `fetch`, `URLSearchParams`, storage events, and optionally Web Locks cover the behavior.

## Assumptions & Open Questions

- A provider may choose not to issue refresh tokens to a browser client; silent renewal must then report `null` and allow interactive acquisition.
- Cross-tab refresh rotation has a race when Web Locks is unavailable. The implementation should test and document its chosen fallback without claiming atomic cross-tab refresh in every browser.
- Full JWT signature and OpenID Connect identity validation are outside the agreed first-release token-validation scope.

## Acceptance Criteria

- An outside-React API service can obtain a non-expired token or explicitly start acquisition and stop its current request.
- A successful refresh returns and persists the new access token and rotated refresh token; concurrent calls within one runtime share one request.
- Expired, revoked, malformed, or unavailable credentials do not appear usable, and network/protocol failures are observable.
