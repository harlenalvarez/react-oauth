# Optionally add verified OpenID Connect identity claims

## User Story

As a consuming app developer using an OpenID Connect provider, I want verified ID-token claims such as subject and email so that I can read identity data directly from the provider without defining a separate app profile endpoint.

## Business Outcome

- An opt-in OIDC configuration exposes only validated ID-token claims through the auth client and React hook.
- The core OAuth plus PKCE flow, including opaque access-token handling and the host profile loader, remains usable without OIDC support.

## Domain Context

- **Bounded Context:** Optional OpenID Connect authentication layered on the OAuth authorization-code client.
- **Primary Capability:** Validate and expose ID-token identity claims.
- **Existing Artifacts Involved:** PKCE authorization transaction, `OauthRequest`, `OauthResponse`, `TokenStorage`, `AuthClient`, `ReactAuthProvider`.
- **New or Updated Artifacts Likely Needed:** OIDC issuer/metadata config, nonce, JWKS-backed ID-token validator, verified-claims state, typed validation errors. No separate user service expected.

## Codebase Evidence

- `src/lib/services/oauth-request/OauthRequest.ts` - currently starts OAuth without an OIDC `nonce` or a dedicated identity mode.
- `src/lib/types/response.type.ts` - models an optional `id_token`, but does not distinguish an unvalidated token from verified claims.
- `src/lib/services/token-storage/TokenStorage.ts` - stores an ID token without validating it or tracking an OIDC transaction nonce.
- `src/lib/services/token/tokenService.ts` - empty validation stub today; stories 1 and 4 replace it for OAuth expiry handling, but not OIDC identity checks.
- `src/lib/context/UserContext.tsx` - unfinished user context that story 1 removes; verified claims should live in the shared auth state.

## File Touch Plan

| Path | Change | Reason |
| --- | --- | --- |
| `src/lib/types/config.type.ts`, `src/lib/types/response.type.ts` | update | Add opt-in OIDC issuer/metadata settings and verified claim/error types while keeping OAuth-only config valid. |
| `src/lib/services/oauth-request/OauthRequest.ts`, `src/lib/services/oauth-request/OauthRequest.test.ts` | update | Request the `openid` scope and bind a cryptographically random nonce to the authorization transaction. |
| `src/lib/services/token-storage/AuthTransactionStorage.ts`, `src/lib/services/token-storage/TokenStorage.ts` | update | Keep the nonce per transaction, clear it after callback, and avoid exposing unvalidated ID tokens as identity. |
| `src/lib/services/oidc-identity/OidcIdentity.ts`, `src/lib/services/oidc-identity/OidcIdentity.test.ts` | create | Load trusted issuer metadata/JWKS and validate ID-token signature and required claims with browser Web Crypto. |
| `src/lib/services/oauth-response/OauthResponse.ts`, `src/lib/services/oauth-response/OauthResponse.test.ts` | update | Validate the returned ID token before committing verified identity in OIDC mode. |
| `src/lib/services/auth-client/AuthClient.ts`, `src/lib/components/auth-provider/ReactAuthProvider.tsx`, `src/lib/context/AuthContext.tsx`, `src/lib/index.ts` | update | Expose verified identity state/methods to service and React consumers. |
| `dev/mock-oauth-server.mjs`, `src/App.tsx`, `README.md`, `docs/getting-started.md` | update | Exercise signed ID tokens and document opt-in configuration, claims, and limitations. |

## Technical Implementation Plan

### Vertical Slice Summary

An OIDC-enabled consumer starts the same authorization-code plus PKCE flow with `openid` scope and a per-transaction nonce. After token exchange, the client validates the ID token against the configured issuer and issuer keys, then publishes typed verified claims including `sub` and optional `email`. Invalid identity data fails the OIDC login and is not published. An OAuth-only consumer continues using granted scopes and an optional host profile loader.

### Entry Points and Orchestration

Add a distinct opt-in OIDC config rather than guessing OIDC from the presence of `id_token`. In OIDC mode, save the random nonce with the PKCE transaction, include it in the authorization request, and require an ID token at `/login-callback`. Complete the token response, validation, and storage transition as one login outcome. On page reload, restore identity only after revalidating the saved ID token. On refresh, validate a replacement ID token if returned; otherwise retain a still-valid prior identity only under a documented provider/session rule, and clear it on logout or invalidation.

### Domain and Application Changes

Use issuer metadata and JWKS from an explicitly trusted issuer, or an explicitly configured trusted JWKS URL. Restrict accepted signing algorithms to implemented asymmetric algorithms such as RS256/ES256; reject `none`, unsupported algorithms, ambiguous keys, malformed/oversized tokens, and mismatched issuer keys. Use `crypto.subtle` to verify the signature. Validate `iss`, `aud`, `azp` when applicable, `exp`, `iat`, `sub`, and the transaction `nonce`, with bounded clock skew; validate optional hash claims when required by the selected OIDC flow. Follow key rotation without accepting keys from an untrusted token header URL. Do not derive identity from the OAuth access token.

### API, UI, Output, or Infrastructure Changes

Expose a clearly named verified identity result, for example `getIdTokenClaims`, on the configured client and `useAuth`; make `sub` required and optional claims such as `email`, `email_verified`, name, and picture explicitly optional. The host may still use story 6's profile loader for app-specific permissions or profile fields. If UserInfo support is later added, require its `sub` to match the verified ID-token `sub` before publishing it. The local fixture should sign ID tokens and publish matching metadata/JWKS for browser testing; it stays out of the package build.

### Data, Contracts, and Edge Cases

This is an **optional follow-on**, not part of the agreed first-release expiry/refresh validation. A provider may omit email even when requested; `sub` is the stable subject claim for that issuer, not necessarily an application database user ID. `email_verified` is separate from email presence. OIDC discovery/JWKS endpoints must be available to the browser with appropriate CORS when loaded directly. Reject unsupported encrypted ID tokens rather than reading their payload. Do not treat a decoded but unverified JWT as identity. Signed UserInfo and broader OIDC features can be scoped separately after this vertical slice.

### Testing and Validation Plan

- `src/lib/services/oidc-identity/OidcIdentity.test.ts` - valid signed token, key rotation, `none`/unsupported algorithms, bad signature, issuer/audience/nonce/expiry mismatch, malformed claims, and missing email.
- `src/lib/services/oauth-request/OauthRequest.test.ts` - opt-in `openid` scope and unique nonce bound to each transaction.
- `src/lib/services/oauth-response/OauthResponse.test.ts` - missing/invalid ID token blocks OIDC login, while OAuth-only code flow still succeeds.
- `src/lib/services/auth-client/AuthClient.test.ts` and `src/lib/components/auth-provider/ReactAuthProvider.test.tsx` - verified claims after callback and reload, clearing on logout, and no publication of unverified claims.
- Validation commands: `npm run build`, `npm run test:deploy`, and the local signed-ID-token fixture flow.

## Dependency & Package Requirements

No new runtime packages required. Browser Web Crypto, `fetch`, and strict local JSON guards cover the planned behavior. The development fixture may use Node built-ins for signing and JWKS publication.

## Assumptions & Open Questions

- Supporting only browser-available asymmetric algorithms initially keeps this optional mode focused; provider algorithms and CORS behavior must be verified against a real OIDC provider before release.
- A provider-specific UserInfo request may later enrich identity, but it must be tied to a validated ID-token subject.
- The initial OAuth release should ship independently if this optional OIDC work is not yet complete.

## Acceptance Criteria

- In opt-in OIDC mode, a valid signed ID token with matching issuer, audience, nonce, and time claims yields typed verified identity claims.
- Invalid or missing ID tokens never populate verified identity or leave a successful OIDC session, while OAuth-only clients continue to work with opaque access tokens.
- The demo and docs show optional email, `email_verified`, and stable subject behavior without claiming that scopes or access-token payloads prove identity.
