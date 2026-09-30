# Run API operations with an async token wrapper

## User Story

As a consuming app developer, I want reusable and one-off async token runners so that API requests do not repeat auth control flow and a page can save its current state before an interactive redirect.

## Business Outcome

- API service methods obtain a usable token, silently renew when possible, and perform a redirect only when interaction is required.
- A reusable wrapped method keeps its argument and result types inferred; a one-off call can await a page-local state save before navigation.

## Domain Context

- **Bounded Context:** Authenticated operation orchestration in the browser client.
- **Primary Capability:** Reusable token-gated async operations.
- **Existing Artifacts Involved:** `AuthClient`, `TokenService`, `acquireToken`, return-path validation, provider lifecycle hooks.
- **New or Updated Artifacts Likely Needed:** Generic `runWithToken` executor, `withToken` wrapper, shared options, and a `TokenRunResult<T>` discriminated result type. No new domain entity expected.

## Codebase Evidence

- `src/lib/services/token/tokenService.ts` - currently an empty singleton stub; story 4 replaces it with expiry-aware token retrieval and renewal.
- `src/lib/services/oauth-response/OauthResponse.ts` - renewal currently stores an access token but returns no token to an API caller and swallows network failures.
- `src/lib/index.ts` - no higher-order helper or configured client is exported for service modules outside React.
- `src/App.tsx` - current consumer demo has no protected API operation or redirect-state preservation example.

## File Touch Plan

| Path | Change | Reason |
| --- | --- | --- |
| `src/lib/services/auth-client/AuthClient.ts`, `src/lib/services/auth-client/AuthClient.test.ts` | update | Add `runWithToken` and a generic `withToken` wrapper sharing story 4's token/refresh methods and story 2's interactive acquisition. |
| `src/lib/types/config.type.ts` or `src/lib/types/auth-operation.type.ts` | update/create | Define typed wrapper options, pre-redirect context, and completed/redirecting result without a runtime dependency. |
| `src/lib/index.ts` | update | Export the wrapper contract through the configured `AuthClient`. |
| `src/App.tsx` | update | Demonstrate one wrapped async API method with an awaited page-state saver and current-page return target. |
| `README.md`, `docs/getting-started.md` | update | Explain both async forms, redirect behavior, and the boundary with HTTP response handling. |

## Technical Implementation Plan

### Vertical Slice Summary

A host service defines a token-taking async request once through `authClient.withToken`, or a page calls `authClient.runWithToken` when its redirect callback needs current component state. Both pass an unexpired token to the operation, or coalesce silent renewal and pass the new token. If neither is available, they resolve a safe internal return path, await an optional pre-redirect callback, start `acquireToken`, and report `redirecting` without issuing the API request.

### Entry Points and Orchestration

Make `runWithToken` a plain async executor on the shared `AuthClient`; it accepts a token-taking operation and a per-call options object. Make `withToken` a TypeScript higher-order function that returns an async function preserving the operation's non-token arguments, not a React component HOC. It may receive stable default options and should delegate to the same runner. Both options include `onRedirectNeeded` (sync or async, awaited before navigation) and `returnTo` (an internal path or a function evaluated at invocation time). Infer argument and success types; always return a Promise of a discriminated `completed` result with the operation value or `redirecting` with no value. This lets a caller distinguish an API result from browser navigation even if a test environment does not unload the document.

### Domain and Application Changes

Use one ordering for all invocations: `getToken`, then `silentRenewToken` if needed, then pre-redirect callback and `acquireToken`. Reuse story 4's in-flight refresh coordination. Call the operation exactly once only after a usable token is obtained. Do not catch or turn a network failure from renewal into an interactive redirect; preserve a typed error so the host can show a retry state. A missing refresh token or a terminal refresh grant denial leads to the redirect branch. If `onRedirectNeeded` rejects, do not navigate or call the operation. If navigation initiation fails, surface the failure instead of reporting success.

### API, UI, Output, or Infrastructure Changes

Export the generic result/options types and document use from non-React services. The demo should wrap a protected `fetch` method once, use the `Authorization` header with `Bearer`, use `runWithToken` where a page must save transient form state only on the redirect branch, and show that it resumes from the validated return path after callback. React components use the same configured client through `useAuth(authClient)`.

### Data, Contracts, and Edge Cases

Validate `returnTo` through the same same-origin/base-path rules as direct `acquireToken`; an external or malformed target must not be persisted or navigated to. Default to the current internal page at invocation time when no explicit target is supplied. A wrapped operation may return a falsy or void value; the `status` discriminant, not truthiness, determines success. Once an API operation has started, an HTTP 401/403 remains its own response/error; the wrapper must not automatically replay a mutation or hide an authorization failure. The host can explicitly retry an idempotent operation after renewal if appropriate. Do not expose refresh tokens to the wrapped callback.

### Testing and Validation Plan

- `src/lib/services/auth-client/AuthClient.test.ts` - both helpers with token available, one shared refresh across simultaneous calls, terminal refresh failure, renewal network error, rejected per-call pre-redirect callback, unsafe return path, inferred argument/result types, and exactly-once operation invocation.
- `src/App.tsx` with the local OAuth fixture - wrapped protected request completes after login and an unauthenticated request saves page state before redirect without fetching.
- Validation commands: `npm run build`, `npm run test:deploy`, and the local demo flow.

## Dependency & Package Requirements

No new packages required. TypeScript generics, browser navigation, and the existing `AuthClient` are sufficient.

## Assumptions & Open Questions

- The wrapper coordinates authentication before an operation. API-specific response parsing, 401/403 handling, retry safety, and request cancellation remain with the host service.
- Navigation may unload the page before a Promise observer runs. The `redirecting` result is still useful for tests and custom navigation adapters; callers must not await it expecting a bearer token in the same call stack.

## Acceptance Criteria

- A typed async API method can be wrapped once and called with its original non-token arguments; a page can alternatively run one operation with current state in its redirect callback. Both expose success values in a `completed` result.
- Missing/expired access tokens trigger one silent renewal attempt; if interaction is required, the pre-redirect callback finishes before acquisition and the API method is not called.
- External return targets, renewal network errors, and rejected pre-redirect callbacks never produce a false successful API result or an unintended redirect.
