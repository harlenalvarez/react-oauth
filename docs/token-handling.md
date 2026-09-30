# Tokens, protected requests, and browser storage

`authClient.withToken(operation)` wraps a reusable async API method whose first argument is a usable access token. `runWithToken(operation, options)` runs a single operation and supports an awaited `onRedirectNeeded` callback. Both return `{ status: 'completed', value }` or `{ status: 'redirecting' }`. A redirect result never contains an API value. Browser navigation to the authorization server may unload the page before the caller observes that result.

Use `runWithToken` to save page state immediately before login:

```ts
const result = await authClient.runWithToken(
  (token) => fetchProject(token, projectId),
  {
    returnTo: () => `${window.location.pathname}${window.location.search}${window.location.hash}`,
    onRedirectNeeded: async () => {
      sessionStorage.setItem('app:project-draft', currentDraft);
    },
  },
);
```

The save callback is awaited. If it rejects, navigation does not start. Token refresh or protocol failures also reject. Neither helper retries an API request after an HTTP 401 or 403; the application decides whether a retry is safe. Lower-level methods are `getToken()`, `getRefreshToken()`, `silentRenewToken()`, and `acquireToken()`. `getToken()` checks expiry without silently renewing. Do not pass refresh tokens to ordinary API methods.

Access and refresh tokens are stored as plain client-namespaced values in `localStorage`, so scripts on the app origin can read them. They survive a reload. The PKCE verifier, OAuth state, optional OIDC nonce, and return path use per-tab `sessionStorage`. The library does not encrypt these values. Protect the host app against script injection and decide whether persistent browser token storage fits its requirements.

Refresh calls in one page runtime are coalesced. Separate tabs do not coordinate rotating refresh tokens. `getGrantedScopes()` returns granted scope metadata from the token response, with requested scopes used when the response omits an unchanged scope. `null` means unknown; access tokens themselves remain opaque. APIs make authorization decisions, even if scopes guide the UI.
