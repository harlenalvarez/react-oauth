# Expose granted scopes and app profile data

## User Story

As a consuming app developer, I want to read granted scopes and optional user data from the auth client so that I can tailor the interface and identify the signed-in user without adding a separate user service to this package.

## Business Outcome

- The host can inspect the current granted scope set, including after refresh and page reload.
- A host-provided authenticated profile loader supplies typed email/user ID and other app-specific data without a separate user service.

## Domain Context

- **Bounded Context:** OAuth grant metadata and app-owned identity/profile data.
- **Primary Capability:** Scope access and typed profile loading.
- **Existing Artifacts Involved:** `TokenResponse`, `TokenStorage`, `AuthClient`, provider context, `afterTokenExchange`, `UserContext` stub.
- **New or Updated Artifacts Likely Needed:** Granted-scope state and a generic profile loader with profile status/error contract. No standalone user service or domain entity expected.

## Codebase Evidence

- `src/lib/types/response.type.ts` - token response includes `scope` and optional `id_token`; `scope` is currently required and `expires_in` incorrectly uses `string`.
- `src/lib/types/jsonWebToken.ts` - a static JWT shape exists but there is no signature validation; story 1 removes this unused type. Access tokens must remain opaque to the OAuth client.
- `src/lib/services/token-storage/TokenStorage.ts` - stores tokens and expiry but not the granted scopes; it cannot restore scope state after reload.
- `src/lib/context/UserContext.tsx` and `src/lib/components/provider/UserProvider.tsx` - unfinished user-state scaffolding, which story 1 removes.
- `src/lib/services/oauth-response/OauthResponse.ts` - exchange and refresh receive a token response but do not expose scope or profile data to callers.

## File Touch Plan

| Path | Change | Reason |
| --- | --- | --- |
| `src/lib/types/response.type.ts`, `src/lib/types/response.type.test.ts` | update | Type optional scope correctly and validate the response before deriving grant metadata. |
| `src/lib/services/token-storage/TokenStorage.ts`, `src/lib/services/token-storage/TokenStorage.test.ts` | update | Persist/restore granted scope metadata with the token record and clear it on logout. |
| `src/lib/services/oauth-response/OauthResponse.ts`, `src/lib/services/oauth-response/OauthResponse.test.ts` | update | Preserve requested scopes when exchange omits unchanged scope and preserve or replace scope appropriately during refresh. |
| `src/lib/services/auth-client/AuthClient.ts`, `src/lib/services/auth-client/AuthClient.test.ts` | update | Expose granted scopes, a typed host profile loader, profile status, and clearing behavior. |
| `src/lib/components/auth-provider/ReactAuthProvider.tsx`, `src/lib/context/AuthContext.tsx`, `src/lib/index.ts` | update | Share typed profile/grant state and methods between React and outside-React consumers. |
| `src/App.tsx`, `README.md`, `docs/getting-started.md` | update | Show scope-based UI hints, a host profile request for email/user ID, and the distinction between OAuth access tokens and verified identity. |

## Technical Implementation Plan

### Vertical Slice Summary

On callback, the library records the effective granted scopes with the token. The host optionally loads an app profile from its authenticated endpoint using the access token; the shared client and `useAuth` expose that typed profile, loading/error status, and granted scopes. After refresh or reload, scopes remain available and the profile can be reloaded. Logout clears both. The library does not inspect access-token payloads.

### Entry Points and Orchestration

Expose `getGrantedScopes` from `AuthClient` and the equivalent snapshot through `useAuth(authClient)`. When the provider response omits `scope`, use the original requested scopes on the first exchange and retain the previous granted set on refresh, following OAuth scope-response rules. If neither a requested nor returned scope is known, report an unknown state rather than an empty grant. A convenience `hasGrantedScopes` may conservatively return false for unknown scopes; it must be documented as a UI hint, not API authorization. Add a generic `loadProfile` host callback, invoked after successful exchange and available again after restoration/renewal. Tie its result type to the configured client and require the client argument in `useAuth` so `getProfile` and the hook infer one profile type without an unchecked caller-selected generic.

### Domain and Application Changes

Treat OAuth access tokens as opaque regardless of string format. The host profile loader owns its endpoint and payload validation, and receives a usable access token from the library. Keep profile data in memory by default, reload it after page refresh as needed, and clear it on logout; do not silently persist arbitrary personal data in localStorage. A future OIDC mode can verify ID-token claims before exposing them, as planned in story 8.

### API, UI, Output, or Infrastructure Changes

Export typed `getGrantedScopes`, profile state, and `getProfile` access through the shared client and React hook. The demo can request a profile from its local fixture and show an email/user ID if the fixture returns one. The consumer guide must distinguish grant scopes, opaque access tokens, ID-token claims, and app profile responses, and explain that servers enforce authorization. Keep the unfinished `UserProvider` removed; profile support belongs to auth state and an app-supplied loader.

### Data, Contracts, and Edge Cases

OAuth access tokens may be opaque or JWTs whose claims are intended for resource servers; the OAuth client must not depend on either format. An ID token is an OpenID Connect identity assertion and requires protocol validation before being treated as authenticated identity; that verification is outside the agreed first release. Do not infer email from a `sub` value. `email_verified` can be false even when email exists. Profile loader failure leaves an otherwise usable OAuth token usable, exposes a profile error/status, and does not trigger an automatic login loop; an app that requires profile/permission work before login can keep using the awaited `afterTokenExchange` hook from story 3. Refresh may narrow scopes, and the UI should update. A server may still reject a request despite locally listed scopes.

### Testing and Validation Plan

- `src/lib/services/oauth-response/OauthResponse.test.ts` - exchange scope present/omitted, refresh scope changed/omitted, and no invented empty grant when scope is unknown.
- `src/lib/services/auth-client/AuthClient.test.ts` - typed profile loading after callback/reload/refresh, loader failure without login loop, logout clearing, and scope updates visible to service callers.
- `src/lib/components/auth-provider/ReactAuthProvider.test.tsx` - scope/profile/status changes reach `useAuth` without a separate user provider.
- Validation commands: `npm run build`, `npm run test:deploy`, and a local fixture flow that displays granted scopes and profile data.

## Dependency & Package Requirements

No new packages required. The host loader can use browser `fetch`; the library uses TypeScript types and existing browser storage APIs. Do not introduce a JWT library to the package runtime.

## Assumptions & Open Questions

- The first release supports OAuth authorization code with PKCE, not full OpenID Connect identity verification. Story 8 is the optional follow-on for **verified** ID-token claims or UserInfo identity.
- The host chooses its profile endpoint and validates its response. The library can coordinate loading and state, but cannot infer a universal user endpoint from OAuth configuration alone.
- If a host later needs server-side decisions based on scopes or roles, its API must make them; client-side scope/profile state only guides presentation.

## Acceptance Criteria

- The client and hook expose the same effective granted scopes after exchange, refresh, and reload, including an explicit unknown state when no scope can be established.
- The package does not inspect access-token claims, and a token format change from JWT to opaque does not change scope/profile behavior.
- A host can supply a typed profile loader for email/user ID; failure is observable without discarding a valid token, and logout clears profile state.
