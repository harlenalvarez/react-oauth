# Complete login on the login-callback page

## User Story

As a user returning from an identity provider, I want the login-callback page to finish login and restore my app page so that I can continue the task I started.

## Business Outcome

- The provider handles the authorization response, exchanges a valid code, waits for optional app-specific follow-up work, and returns to the saved internal page.
- The host can replace the visible “Logging in…” view and receive typed completion/error events without taking over callback security logic.

## Domain Context

- **Bounded Context:** Browser login callback and OAuth token establishment.
- **Primary Capability:** Complete one authorization transaction and persist its token result.
- **Existing Artifacts Involved:** `OauthResponse`, `TokenStorage`, `TokenResponse`, `OAuthError`, transaction and provider from story 2.
- **New or Updated Artifacts Likely Needed:** Validated token response, typed login-callback result/error, token record with expiry, login-callback view props, awaited `afterTokenExchange` hook.

## Codebase Evidence

- `src/lib/services/oauth-response/OauthResponse.ts` - parses code/error but treats `state` as a return path, uses `FormData`, does not check HTTP status or token shape, and persists results through `Promise.allSettled`.
- `src/lib/types/response.type.ts` - `expires_in` is typed as a string and `refresh_token`/`scope` are required even though a provider may omit them.
- `src/lib/services/token-storage/TokenStorage.ts` and `src/lib/utils/index.ts` - the current deterministic AES-GCM IV and code-derived key do not provide a sound browser token-storage boundary.
- `src/lib/services/oauth-response/OauthResponse.test.ts` - tests expect multipart form data and do not cover state mismatch, duplicate callback, or custom follow-up work.

## File Touch Plan

| Path | Change | Reason |
| --- | --- | --- |
| `src/lib/types/response.type.ts`, `src/lib/types/response.type.test.ts` | update/create | Model success/error data from unknown JSON, numeric expiry, optional refresh/ID tokens, and an explicit error union. |
| `src/lib/services/oauth-response/OauthResponse.ts`, `src/lib/services/oauth-response/OauthResponse.test.ts` | update | Validate callback state, exchange code with URL-encoded form data, check status and response shape, and report typed failures. |
| `src/lib/services/token-storage/AuthTransactionStorage.ts` | update | Consume state/verifier once, retrieve/clear its saved return path, and reject stale or mismatched transactions. |
| `src/lib/services/token-storage/TokenStorage.ts`, `src/lib/services/token-storage/TokenStorage.test.ts` | update | Persist a typed token record and expiry in localStorage; remove deterministic encryption and generated-code storage. |
| `src/lib/utils/index.ts`, `src/lib/utils/utils.test.ts` | update | Remove the obsolete `genKey` and token-obfuscation helpers while retaining any pure URL/base64 utility still needed. |
| `src/lib/services/auth-client/AuthClient.ts`, `src/lib/services/auth-client/AuthClient.test.ts` | update | Orchestrate one callback exchange, awaited host follow-up, token commit, status, and return navigation. |
| `src/lib/components/login-callback-page/LoginCallbackPage.tsx`, `src/lib/components/login-callback-page/LoginCallbackPage.test.tsx` | create | Render default or host-supplied logging-in/progress/error view while the client owns exchange logic. |
| `src/lib/components/auth-provider/ReactAuthProvider.tsx`, `src/lib/types/config.type.ts`, `src/lib/index.ts` | update | Recognize the `loginCallback` path and type/export `LoginCallbackView`, navigation adapter, and event hooks. |
| `src/App.tsx` | update | Show login-callback progress/result and the restored route in the local consumer app. |

## Technical Implementation Plan

### Vertical Slice Summary

The authorization server returns to the configured `/login-callback` path (or its configured equivalent). The provider renders the login-callback page, validates the matching transaction and provider response, exchanges the code, awaits optional extra permission work, commits tokens, emits completion, and restores the saved same-origin page. The default view says “Logging in…”.

### Entry Points and Orchestration

Run `onLoginCallbackStart` once, then invoke the library-owned callback method. Pass a typed token result and access token to `afterTokenExchange` so an app may fetch extra permissions; await it before treating login as complete. On success, invoke `onLoginComplete`; on any error, invoke `onLoginError` once with stage `loginCallback` and show the custom/default error view. A rejected follow-up hook must not leave a half-authenticated stored session.

### Domain and Application Changes

Compare returned `state` with the saved random transaction before exchanging the code. Send `grant_type=authorization_code`, `client_id`, `code`, `code_verifier`, and the same `redirect_uri` used on initiation with `application/x-www-form-urlencoded`. Parse JSON as `unknown`, check `response.ok`, validate required access-token fields, and handle OAuth error data. Compute expiry from numeric `expires_in`, preserve an optional rotated refresh token and optional ID token, and commit a single namespaced token record to localStorage. Store the granted `scope` from the response; when omitted, retain the originally requested scopes under RFC 6749's unchanged-scope rule. Do not store the authorization code or an encryption key derived from it.

### API, UI, Output, or Infrastructure Changes

Offer a typed custom `LoginCallbackView` for the visible screen, including progress and error states. For return navigation, use a supplied host navigation adapter when present; otherwise use `history.replaceState()` to the validated internal path and dispatch one synthetic `popstate` event. Clear code/state from the address bar or replace the login-callback entry on completion or terminal error. When a host adapter is installed, use its location subscription and navigation API without mutating history or dispatching another event.

### Data, Contracts, and Edge Cases

Missing code, provider error, missing/mismatched/expired state, missing verifier, malformed JSON, HTTP error, storage failure, and callback replay each produce a typed failure and no successful auth status. Guard the exchange against duplicate execution from React Strict Mode and browser Back. Clear one-time transaction data on terminal completion. If the stored return path is absent or no longer allowed, return to the app root.

### Testing and Validation Plan

- `src/lib/services/oauth-response/OauthResponse.test.ts` - exact URL-encoded request, state/verifier mismatch rejection, malformed response, HTTP and network failures, optional token fields, and duplicate callback prevention.
- `src/lib/services/token-storage/TokenStorage.test.ts` - expiry/token persistence, namespaced keys, scope/refresh/ID-token optionality, and complete clearing without the old AES wrapper.
- `src/lib/components/login-callback-page/LoginCallbackPage.test.tsx` - custom view, hook ordering, awaited extra-permission step, failed extra step, and return navigation.
- Validation commands: `npm run build`, `npm run test:deploy`, and `npm start` with the dev OAuth provider when available.

## Dependency & Package Requirements

No new packages required. Use browser `fetch`, `URLSearchParams`, Web Crypto, and Web Storage. The authorization server must support CORS at the token endpoint and an exactly registered callback URI.

## Assumptions & Open Questions

- This is OAuth authorization code flow. `id_token` is optional and is not treated as validated OpenID Connect identity data in this release.
- LocalStorage is required for tokens by product choice; the browser's same-origin JavaScript can read it. The implementation must document this and make no encryption claim.
- Use `onLoginComplete` for successful completion and `onLoginError` for errors from either login stage; the error payload distinguishes `login` from `loginCallback`.

## Acceptance Criteria

- A matching callback completes one code exchange, awaits host follow-up work, stores a usable token record, and returns to the original internal page.
- Any mismatched/replayed callback or failed follow-up shows a typed error and leaves no successful stored session.
- Both default and host-supplied callback views work without giving the host responsibility for state, code exchange, or token storage.
