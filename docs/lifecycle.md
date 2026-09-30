# Auth lifecycle hooks

Configure hooks on the shared client so they remain available after the authorization server redirects back to the app. Hooks receive typed events and run inside the library's stage handling:

| Hook | Timing and failure behavior |
| --- | --- |
| `onLoginStart` | Awaited before the authorization-server redirect. Rejection prevents the redirect. |
| `onLoginCallbackStart` | Awaited before callback validation and exchange. Rejection fails login. |
| `afterTokenExchange` | Awaited after response validation, before tokens are saved. Rejection fails login. |
| `onLoginComplete` | Awaited after tokens are saved, before profile loading and return navigation. Rejection fails login and removes tokens saved by that callback. |
| `onLoginError` | Receives the original failure and its stage. Observer rejection cannot replace the original error. |
| `onTokenRenewed` | Awaited after refreshed tokens are saved. Rejection rejects renewal; the refreshed token remains stored. |
| `onLogoutStart`, `onLogout` | Awaited before and after local credential clearing. Rejection reports logout failure; a current logout still clears credentials. |
| `onLogoutError` | Receives logout failure. Observer rejection cannot undo credential clearing. |

For example, to require a permission setup request during login:

```ts
hooks: {
  afterTokenExchange: async ({ accessToken }) => {
    const response = await fetch('/api/permissions/prepare', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Permission setup failed: ${response.status}`);
  },
}
```

Use `loadProfile` for data that must load again after a page refresh. It reports failures separately, so optional profile data cannot cause a login loop. Logout clears local tokens even if a host logout hook fails; it does not end the identity provider's server session.

Location observation starts in provider layout setup and immediately reconciles the current URL. Async initialization and auth-stage work use passive effects. Strict Mode shares work within a stage entry; leaving and entering again creates a new entry. Abandoned continuations do not update screens, navigate, or clear a later session. Host hook side effects already underway cannot be cancelled by the library, so make host work idempotent and avoid navigating from a pending hook.
