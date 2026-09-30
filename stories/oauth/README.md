# OAuth package delivery plan

These stories implement the gaps recorded in [`docs/project-status.md`](../../docs/project-status.md). Complete them in order:

1. [Restore the build and runnable consumer app](01-runnable-package-and-demo.md)
2. [Start authorization through a configurable login page](02-login-and-pkce-start.md)
3. [Complete login on the login-callback page](03-login-callback-and-token-exchange.md)
4. [Expose usable tokens and silent renewal](04-token-access-and-renewal.md)
5. [Run API operations with an async token wrapper](05-async-token-wrapper.md)
6. [Expose granted scopes and app profile data](06-granted-scopes-and-profile.md)
7. [Complete logout and the consumer integration](07-logout-and-integration.md)
8. [Optionally add verified OpenID Connect identity claims](08-verified-oidc-identity.md)

## Working contract for these stories

- The public wrapper is `ReactAuthProvider`. It recognizes the configured auth paths around the host `<App />`, so the host does not need to render the three auth pages itself. Defaults are `/login`, `/login-callback`, and `/logout` for login, login-callback, and logout. The `paths` keys are `login`, `loginCallback`, and `logout`; the login-callback page's default visible text is “Logging in…”.
- The host can replace each page's **view component** with a typed component. The library retains flow orchestration, callback validation, storage, and navigation. Name the second stage **login-callback** in routes/files and `LoginCallback` in TypeScript; use “Logging in…” for visible progress text.
- A shared `AuthClient` supports code outside React; the provider and `useAuth(authClient)` use the same configured instance. `getToken()` returns a usable token or `null`; `silentRenewToken()` uses a refresh token when one exists; `acquireToken({ returnTo })` starts an interactive redirect and does not return a token to the same call stack. `getRefreshToken()` is explicit.
- `withToken(operation, options)` wraps a reusable async API method. `runWithToken(operation, options)` handles a one-off call whose awaited pre-redirect hook can capture current page state. Both obtain or renew a token and return a discriminated `completed` or `redirecting` result. A request is never run after redirect starts.
- The proposed consumer syntax is recorded in [`docs/getting-started.md`](../../docs/getting-started.md). Implement the public names and types consistently with that guide as these stories are completed.
- Granted scopes come from the OAuth token response, with the original requested scopes used when the response omits an unchanged scope. Optional typed app profile data comes from a host-provided authenticated loader; no separate user service is needed. Treat access tokens as opaque. A later, opt-in OpenID Connect story covers **verified** ID-token claims such as `sub` and `email`.
- For the first release (stories 1–7), “validate token” means checking saved expiry and refresh eligibility. An access token can be opaque. JWT signature verification and OpenID Connect ID-token validation belong to the optional follow-on story 8.
- Access and refresh tokens persist in namespaced `localStorage`, per the product requirement. Treat this as a documented browser security tradeoff. Do not reuse the old deterministic AES-GCM wrapper. A per-tab `sessionStorage` authorization transaction holds the verifier, random `state`, and validated internal return path. `state` is not the return path.
- `acquireToken()` captures the current internal path **before** navigating to `/login`. If the host navigates directly to `/login` without passing a return path, use `/` or the configured base path. The History API cannot inspect an earlier stack entry after navigation.
- The provider should replace auth entries after completion and prevent a second token exchange on revisiting the callback. It should also redirect an already authenticated user who revisits `/login`. The current SPA implementation updates History API state and dispatches `popstate` by default; an optional full navigation adapter observes host routers and calls their navigate API. The authorization-server redirect remains a full document navigation.
- Lifecycle hooks include `onLoginStart`, `onLoginCallbackStart`, `afterTokenExchange` (awaited for app-specific permission work), `onLoginComplete`, `onLoginError` (with a typed failing stage), `onTokenRenewed`, and `onLogout`. Hook payloads and failure behavior are defined in the relevant stories.
- No new runtime packages. Remove `@practicaljs/ts-kit`; use TypeScript's built-in utility types and narrow local guards for unknown network data.

The later SPA integration uses React 19+, `AuthClientProvider` and `AuthBoundary` for layout composition, an `AuthScreen` for responsive defaults, and a full router adapter with navigation and location subscriptions. The shorter [getting-started guide](../../docs/getting-started.md) and [router guide](../../docs/router-integration.md) describe the current public contract; the stage-navigation sections in individual stories use the same SPA contract. Original file plans remain historical implementation context.

The protocol plan follows [OAuth for browser-based applications (RFC 10017)](https://www.rfc-editor.org/rfc/rfc10017.html), the [OAuth security best current practice (RFC 9700)](https://www.rfc-editor.org/rfc/rfc9700.html), [OAuth token response scope semantics (RFC 6749)](https://www.rfc-editor.org/rfc/rfc6749.html), and the [JWT access-token profile (RFC 9068)](https://www.rfc-editor.org/rfc/rfc9068.html), which says clients must treat access tokens as opaque. [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html) defines separate ID-token and UserInfo identity claims. TypeScript's [`Partial`, `Pick`, and `Omit`](https://www.typescriptlang.org/docs/handbook/utility-types.html) cover the current utility-type dependency. Browser history behavior follows the [HTML Standard's navigation and session history rules](https://html.spec.whatwg.org/multipage/browsing-the-web.html).
