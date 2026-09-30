# Complete logout and the consumer integration

## User Story

As a consuming app developer, I want a configurable logout stage and a runnable end-to-end example so that I can verify the full login, token, renewal, and logout experience with my own page designs and hooks.

## Business Outcome

- `/logout` clears local auth state and shows default or custom progress/completion UI.
- A local fixture exercises all three stages, a wrapped API request, scopes, and optional profile loading without third-party runtime packages; the README explains how a host integrates them.

## Domain Context

- **Bounded Context:** OAuth session termination and library consumption.
- **Primary Capability:** Local logout plus a verifiable complete browser flow.
- **Existing Artifacts Involved:** `ReactAuthProvider`, `AuthClient`, `TokenStorage`, login/callback pages and hooks, Vite consumer app.
- **New or Updated Artifacts Likely Needed:** Logout status/result and view props; a development-only mock authorization/token server. No standalone user service expected; story 6's optional profile data stays in auth state.

## Codebase Evidence

- `src/lib/components/provider/OauthProvider.tsx` and `src/App.tsx` - the current wrapper has no route-specific UI and the app is still a Vite starter/token-text demo.
- `src/lib/services/token-storage/TokenStorage.ts` - individual fields can be emptied, but no complete logout transaction clears tokens and pending auth state together.
- `src/lib/index.ts` and `README.md` - the current public exports and documentation do not describe a composable provider or consumer-side service workflow.
- `vite.config.ts` - already hosts the development app and produces a library build; a dev-only fixture can reuse this setup without entering `src/lib`.

## File Touch Plan

| Path | Change | Reason |
| --- | --- | --- |
| `src/lib/components/logout-page/LogoutPage.tsx`, `src/lib/components/logout-page/LogoutPage.test.tsx` | create | Own the logout stage with default/custom progress, completion, and error views. |
| `src/lib/services/auth-client/AuthClient.ts`, `src/lib/services/auth-client/AuthClient.test.ts` | update | Add idempotent local logout and typed lifecycle events. |
| `src/lib/services/token-storage/TokenStorage.ts`, `src/lib/services/token-storage/AuthTransactionStorage.ts` | update | Clear access/refresh/ID token records and abandoned transactions for the configured client. |
| `src/lib/components/auth-provider/ReactAuthProvider.tsx`, `src/lib/components/auth-provider/ReactAuthProvider.test.tsx` | update | Intercept the logout path, complete the typed view/hook contract, and prevent auth-route Back loops. |
| `src/lib/types/config.type.ts`, `src/lib/index.ts` | update | Type/export logout path, view override, lifecycle hooks, and navigation behavior. |
| `dev/mock-oauth-server.mjs`, `package.json` | create/update | Provide a dev-only authorization/token/profile fixture using Node built-ins and a command to start it. |
| `vite.config.ts` | update | Resolve the package name to the public `src/lib/index.ts` for the local demo during development, while preserving library output and consumer package exports. |
| `src/App.tsx`, `src/App.css`, `src/main.tsx` | update | Demonstrate login, login-callback, protected request, refresh, logout, and custom view/hook wiring. |
| `README.md`, `docs/getting-started.md`, `docs/project-status.md` | update/create | Document the provider setup, three routes, client methods, hooks, fixture commands, router adapter, browser storage, and current completion status. |

## Technical Implementation Plan

### Vertical Slice Summary

A developer starts the Vite consumer app and the local mock provider, performs login, sees the login-callback progress screen, reaches the original page, invokes a wrapped bearer-token request, observes granted scopes and optional profile data, renews the token, then visits `/logout`. The page clears the local session, emits logout events, and returns to a configured public route. Repeating logout or using Back does not resurrect auth state.

### Entry Points and Orchestration

The provider recognizes the configured logout path before rendering children. `AuthClient.logout()` navigates to that path from ordinary UI; `LogoutPage` then invokes an internal idempotent client completion method that clears storage and changes status. A direct visit to the path performs the same completion. `onLogout` runs after local state is cleared; logout errors receive a typed stage/error event. A failure in a host logout hook can be displayed but must not restore tokens. The host may pass `views={{ LoginView, LoginCallbackView, LogoutView }}` with typed stage status and a normalized public error containing a message; all three auth-stage view overrides are documented together. Optional `onLogoutStart`/`onLogoutError` hooks should follow the same typed event convention as the login hooks. The provider receives an optional `AuthNavigationAdapter` with `navigate({ to, replace })`, `getLocation()`, and `subscribe(listener)` for internal paths and installs it on the shared client for service calls; external authorization navigation stays browser-owned.

### Domain and Application Changes

Clear access, refresh, optional ID token, expiry, granted scopes, in-memory profile, and outstanding transaction/return-path data for only the configured client. Make repeated local logout safe. Verify that the login route uses story 4's expiry-aware status to redirect an already authenticated visitor to an allowed internal page, and that a revisited callback does not redeem a code twice. Provider-level logout is local only unless an authorization-server end-session URL or token-revocation contract is explicitly configured later.

### API, UI, Output, or Infrastructure Changes

Provide a small default logout view and allow full replacement of the login, callback, and logout views without replacing control logic. The mock server should issue a code, require and echo the client's `state`, enforce PKCE at exchange, return typed tokens and scopes, model refresh-token rotation, and serve an authenticated example profile for local development. Keep it under `dev/` and outside package exports. Make the Vite example import the package by name through its public entry, using a development-only alias to `src/lib/index.ts`. Document `getToken`, `silentRenewToken`, `acquireToken`, `getRefreshToken`, `withToken`, `runWithToken`, granted scopes, and optional profile access with a consumer request example that uses `Authorization: Bearer` and returns when acquisition redirects. Include a typed navigation adapter example for router-driven apps; use `history.replaceState` followed by one synthetic `popstate` event as the default.

### Data, Contracts, and Edge Cases

Default logout path is `/logout`; default post-logout target is `/` or the configured base path. Reject external return targets. Use replacement navigation after completing auth stages so Back does not re-run side effects. Do not assume `replaceState` dispatches `popstate`; a host adapter must call its router API, while the default navigator explicitly dispatches one event after updating history. Document that local logout does not necessarily end the identity provider's server session. The fixture uses fake tokens and is never packaged.

### Testing and Validation Plan

- `src/lib/components/logout-page/LogoutPage.test.tsx` - default/custom view, hook order, repeated logout, hook failure, and safe return target.
- `src/lib/services/auth-client/AuthClient.test.ts` - `logout()` navigation to the configured stage, scoped clearing after stage completion, and no token access after logout.
- `src/lib/components/auth-provider/ReactAuthProvider.test.tsx` - `/login`, `/login-callback`, and `/logout` route interception plus Back/replay behavior.
- `src/App.tsx` with `dev/mock-oauth-server.mjs` - manual full-flow check including a wrapped request, profile loading, granted-scope change on refresh, and a host callback that performs an extra permission request.
- Validation commands: `npm run build`, `npm run test:deploy`, `npm start`, the new `npm run dev:mock`, and `npm pack --dry-run`.

## Dependency & Package Requirements

No new packages required. The mock server uses Node built-ins as development infrastructure and is excluded from the published library.

## Assumptions & Open Questions

- `onLogout` describes completion of local logout. Identity-provider logout, token revocation, and single logout need provider-specific endpoints and are deferred.
- The demo's local mock is a protocol fixture, not a security conformance certification; a real identity provider should be tested before release.
- A host can supply a navigation adapter for React Router or TanStack Router without adding either router as a library runtime dependency.

## Acceptance Criteria

- Visiting `/logout` clears the configured client's session once, calls `onLogout`, shows default or custom UI, and leaves other client IDs unaffected.
- An authenticated user who revisits `/login` or `/login-callback` by Back cannot start or complete a second login unintentionally.
- A new developer can follow the README to run the local OAuth fixture and observe login, login-callback, wrapped token use, scopes, optional profile, refresh, logout, custom views, and an awaited post-exchange hook.
- `npm run build`, `npm run test:deploy`, and `npm pack --dry-run` succeed with no new runtime dependency.
