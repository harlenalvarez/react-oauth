# Project status: React OAuth library

Snapshot: 2026-09-30

All stories in [`stories/oauth/`](../stories/oauth/README.md), including the optional OIDC follow-on, are implemented in this checkout. The public contract is described in [`getting-started.md`](getting-started.md).

## Implemented

- `createAuthClient` normalizes endpoints, app base URLs, auth paths, scopes, and optional OIDC configuration. A registry reuses matching clients and rejects conflicting configuration for the same client ID.
- `ReactAuthProvider` handles `/login`, `/login-callback`, and `/logout` before rendering the consumer app. `useAuth(client)` exposes typed status, token actions, scopes, profile state, and verified OIDC claims.
- Authorization uses a random PKCE verifier, S256 challenge, random OAuth state, and (in OIDC mode) a per-transaction nonce. The verifier/state/nonce are scoped to a browser tab; callback state is validated before the code exchange.
- Authorization-code and refresh requests use URL-encoded form bodies. JSON is treated as unknown until narrow local guards validate it. Tokens and expiry are stored as a client-namespaced record in `localStorage`.
- `getToken`, `getRefreshToken`, `silentRenewToken`, `acquireToken`, `withToken`, and `runWithToken` are available to service and React consumers. Refresh calls coalesce per client in the current runtime.
- Granted scopes come from token responses, requested scopes are used when the initial response omits `scope`, and unknown scopes remain `null`. A host-owned typed profile loader runs after login, renewal, and restoration; its failures do not discard a usable OAuth token.
- OIDC mode verifies RS256 ID-token signatures using an explicitly configured trusted JWKS URL and validates issuer, audience, authorized party, time claims, and callback nonce. OAuth-only mode does not expose an ID token as verified identity.
- Login, login-callback, and logout views are replaceable. A host can install a router adapter for internal navigation. Local logout clears auth state and is idempotent; it does not end the provider's server session.
- Internal auth routes use History API push/replace plus `popstate` by default. A complete adapter observes and navigates through a host router. `AuthClientProvider` and `AuthBoundary` support a composable layout; `AuthScreen` provides responsive defaults and message overrides.
- React 19's `useSyncExternalStore` connects the stable client to `useAuth`, `useAuthStatus`, and `useAuthProfile`. `useAuthClient` returns actions without subscribing.
- Provider layout setup attaches location observation before passive auth work and reconciles navigation that happened before setup. Stage-entry identities prevent abandoned work from updating a later visit to the same auth route.
- The Vite consumer imports the package through its public name and connects to the Node built-in mock provider under `dev/`.

## Validation

- `npm run build` checks library and Vite configuration types and emits an ESM library bundle and bundled declarations. It uses Vite's Rolldown options and the official React plugin; React and its JSX runtime remain external.
- `npm run test:deploy` passes 69 tests covering config normalization, PKCE request construction, state and callback handling, token storage and refresh, wrappers, profile behavior, shared layout-time route observation, abandoned stage work, real React Router and TanStack Router login/callback/logout and Back/Forward at root and nested bases, and ID-token validation.
- `npm run check:router-examples` type-checks both router adapters and their integration examples.
- `node --check dev/mock-oauth-server.js` succeeds.
- `npm run check:package` checks ESM-only package contents, verifies automatic styles and generic provider/hook types under Bundler and NodeNext resolution, and builds a separate Vite React consumer from the tarball. Router fixtures are excluded. The package is configured for public publication as `@huddle-ai/auth`; [local installation](package-development.md) uses a built tarball, and [releasing](releasing.md) describes initial setup and CI publication.
- A browser smoke test completed login, callback exchange, protected project request, renewal, and SPA logout against the local fixture. The default error screen filled a 320-pixel viewport, wrapped long text without horizontal overflow, and grew vertically when needed.

## Security and release limits

Tokens are stored as plain values in `localStorage`; browser scripts on the app origin can read them. The project documents this tradeoff and does not claim that encoding or client-side obfuscation encrypts tokens. Deployments should protect the app against XSS and decide whether browser persistence meets their requirements.

OIDC currently supports signed RS256 ID tokens with RSA JWKS keys. Encrypted ID tokens, UserInfo, other signing algorithms, provider revocation, cross-tab refresh coordination, and server-side authorization are outside this implementation. The local provider is a protocol fixture, not a production identity provider or security certification.
