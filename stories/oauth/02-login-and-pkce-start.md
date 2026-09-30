# Start authorization through a configurable login page

## User Story

As a consuming app developer, I want a configurable `/login` stage and an `acquireToken` action so that a user can start an OAuth authorization code flow and return to the page that requested it.

## Business Outcome

- A host can wrap `<App />` with `ReactAuthProvider`, invoke an auth client outside React or a hook inside React, and begin interactive authorization without installing a router or OAuth package.
- The host can supply its own login view and receive typed start/error events while the library owns PKCE and navigation.

## Domain Context

- **Bounded Context:** Browser OAuth authorization initiation.
- **Primary Capability:** Build and launch one PKCE transaction for a configured public client.
- **Existing Artifacts Involved:** `OauthConfig`, `OauthRequest`, `getOathRequestService`, `getTokenStorage`, `OauthProvider`, `ConfigContext`, root demo.
- **New or Updated Artifacts Likely Needed:** Normalized `AuthConfig`, per-tab `AuthTransaction` with random state/verifier/time, shared `AuthClient`, login-stage status and view props.

## Codebase Evidence

- `src/lib/services/oauth-request/OauthRequest.ts` - request URL omits `response_type`, `scope`, and `code_challenge_method`; its verifier uses only one hex digit per byte and its `state` is an unverified return path.
- `src/lib/services/token-storage/TokenStorage.ts` - PKCE keys are global and `getTokenStorage` never registers the newly created instance in `storageMap`.
- `src/lib/services/oauth-response/OauthResponse.ts` - `getOauthResponseService` also lacks the `responseMap.set` call and constructs a separate storage object.
- `src/lib/components/provider/OauthProvider.tsx` - currently only creates a config context; it has no path handling or auth actions.

## File Touch Plan

| Path | Change | Reason |
| --- | --- | --- |
| `src/lib/types/config.type.ts`, `src/lib/types/config.type.test.ts` | update | Normalize and validate typed `clientId`, endpoints, scopes, base URL, `login`/`loginCallback`/`logout` paths, and URL defaults. |
| `src/lib/types/auth-transaction.type.ts` | create | Define a transaction with random `state`, PKCE verifier, creation time, and client identity. |
| `src/lib/services/token-storage/AuthTransactionStorage.ts` | create | Persist a transaction and same-origin return path in per-tab sessionStorage; provide one-time retrieval and cleanup. |
| `src/lib/services/token-storage/TokenStorage.ts` | update | Fix per-client registration and key scoping; leave token-record redesign to story 3. |
| `src/lib/services/oauth-request/OauthRequest.ts`, `src/lib/services/oauth-request/OauthRequest.test.ts` | update | Generate a strong verifier and full authorization URL; begin navigation once. |
| `src/lib/services/oauth-response/OauthResponse.ts` | update | Make response service and request service share the configured store and fix its registry behavior. |
| `src/lib/services/auth-client/AuthClient.ts`, `src/lib/services/auth-client/AuthClient.test.ts` | create | Expose one stable service graph per normalized configuration to both React and non-React callers. |
| `src/lib/context/AuthContext.tsx` | create | Hold the shared client and typed auth actions for `useAuth`. |
| `src/lib/components/auth-provider/ReactAuthProvider.tsx`, `src/lib/components/auth-provider/ReactAuthProvider.test.tsx` | create | Replace the config-only provider with path-aware orchestration and typed hooks/context. |
| `src/lib/components/login-page/LoginPage.tsx`, `src/lib/components/login-page/LoginPage.test.tsx` | create | Own `/login` initiation, default progress/error presentation, and optional host view override. |
| `src/lib/components/provider/OauthProvider.tsx`, `src/lib/context/ConfigContext.tsx`, `src/lib/components/index.ts`, `src/lib/context/index.ts`, `src/lib/index.ts` | update/remove | Replace the old public wrapper and export the new provider, client, hook, and types. |
| `src/App.tsx` | update | Exercise `acquireToken()` and display the computed internal return path in the local demo. |

## Technical Implementation Plan

### Vertical Slice Summary

From a host page, `acquireToken` records an allowed return path before moving to the configured login path. `ReactAuthProvider` renders `LoginPage` on that path. The page creates one transaction, calls `onLoginStart`, builds the complete authorization URL, and navigates to the authorization server.

### Entry Points and Orchestration

Support both a shared `AuthClient` for API services outside React and `useAuth(authClient)` for components; passing the client keeps optional profile types inferred and detects a mismatched provider. Export `createAuthClient` with the consumer-facing names `authorizationEndpoint`, `tokenEndpoint`, optional `appBaseUrl`/`redirectUri`, and grouped `paths` with `login`, `loginCallback`, and `logout` keys. The provider receives the created client as `client` and recognizes configured auth paths before rendering children. On the login path, the library handles the redirect; a custom `LoginView` changes presentation and receives status/error props without receiving ownership of PKCE logic. An async `onLoginStart` may pause the redirect; rejection calls `onLoginError` with stage `login` and renders an error state. Keep lifecycle hooks on the client configuration so they are available after full-page return.

### Domain and Application Changes

Generate a verifier from Web Crypto random bytes with the RFC 7636 length/alphabet requirements and an `S256` challenge. Generate a separate unpredictable `state`, save it with the verifier and internal return path in tab-scoped storage. Build `response_type=code`, `client_id`, exact configured `redirect_uri`, `scope` when present, `code_challenge`, `code_challenge_method=S256`, and `state`. Use a stable per-configuration service registry: identical normalized configuration reuses a client and store; a conflicting configuration for the same client identity must fail clearly rather than reuse stale endpoints.

### API, UI, Output, or Infrastructure Changes

Default route paths are `/login`, `/login-callback`, and `/logout` when the app base defaults to the current origin. Configured `paths` are relative to `appBaseUrl`, so an app under `/workspace/` can use `login`, `login-callback`, and `logout` without repeating the base prefix. The login page shows a lightweight redirecting state. Keep any styling in a sibling plain CSS file if it grows beyond trivial markup. Export the new API from `src/lib/index.ts`, with accurate names instead of the existing `Oath`/`Storge` misspellings.

### Data, Contracts, and Edge Cases

`acquireToken({ returnTo })` accepts a typed optional return target and initiates navigation; it does not return an access token. Normalize the target with `URL` and accept only the configured app origin/base path, including safe query and hash parts. For an external or auth-stage target, do not save it and use `/` or the configured base path. A direct visit to `/login` has no readable previous stack entry, so it starts with the fallback target. Scope transaction keys by client and tab; expire stale transactions. Ensure React Strict Mode does not generate two transactions or duplicate `onLoginStart` calls.

### Testing and Validation Plan

- `src/lib/services/oauth-request/OauthRequest.test.ts` - verifier/challenge properties, complete URL parameters, HTTPS/localhost validation, and unique state.
- `src/lib/services/auth-client/AuthClient.test.ts` - same config shares one graph, different clients are isolated, conflicting same-client config fails, and invalid return paths fall back safely.
- `src/lib/components/auth-provider/ReactAuthProvider.test.tsx` - `useAuth(authClient)` reads the matching provider and rejects a mismatched client.
- `src/lib/components/login-page/LoginPage.test.tsx` - custom view, hook order, one redirect under Strict Mode, and error presentation.
- Validation commands: `npm run build`, `npm run test:deploy`, and `npm start` with the login route in the demo.

## Dependency & Package Requirements

No new packages required. Use `crypto.getRandomValues`, `crypto.subtle`, `URL`, Web Storage, and React already in the repository.

## Assumptions & Open Questions

- An authorization server and token endpoint for a browser public client will permit the registered callback URL and CORS token requests. The local demo can use a dev-only mock until a real provider is configured.
- `onLoginStart` is a pre-redirect hook; sensitive verifier/state values stay library-owned.
- The already-authenticated login-page guard becomes complete after story 4 adds expiry-aware `getToken`.

## Acceptance Criteria

- A host action can reach the configurable login page, show either default or custom UI, and launch a single valid authorization-code-with-PKCE request.
- The original internal page is saved before navigation; external targets are rejected and resolve to the app root.
- Repeated mounts and duplicate calls do not create conflicting transactions or expose stale service configuration.
