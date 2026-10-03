# Auth lifecycle hooks

Configure hooks on the shared client so they remain available after the authorization server redirects back to the app. Hooks receive typed events and run inside the library's stage handling:

| Hook | Timing and failure behavior |
| --- | --- |
| `onLoginStart` | Awaited before the authorization-server redirect. Rejection prevents the redirect. |
| `onLoginCallbackStart` | Awaited after response/state validation, before handling the accepted response or exchanging tokens. Rejection fails login. Replayed completed/cancelled outcomes do not repeat this hook. |
| `afterTokenExchange` | Awaited after response validation, before tokens are saved. Rejection fails login. |
| `onLoginComplete` | Awaited after tokens are saved, before profile loading and return navigation. Rejection fails login and removes tokens saved by that callback. |
| `onLoginError` | Receives the original failure and its stage. Observer rejection cannot replace the original error. Browser Back and verified provider denial cancellation do not invoke this hook. Navigation recovery errors are separate. |
| `onTokenRenewed` | Awaited after refreshed tokens are saved. Rejection rejects renewal; the refreshed token remains stored. |
| `onLogoutStart`, `onLogout` | Awaited before and after local credential clearing. Rejection reports an error; a current logout still clears credentials and attempts configured provider logout. These hooks run once at initiation, not again on return. |
| `onLogoutError` | Receives logout failure. Observer rejection cannot undo credential clearing. An unconfirmed/cancelled provider logout and navigation recovery errors do not invoke this hook. |

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

Use `loadProfile` for data that must load again after a page refresh. It reports failures separately, so optional profile data cannot cause a login loop. Logout clears local tokens even if a host logout hook fails. `onLogout` observes local cleanup; it does not confirm provider session termination. When `endSessionEndpoint` is configured, the library owns the provider redirect and return validation. Hook failures are reported through `onLogoutError` and `authError` and do not block that provider attempt. Local-only logout still rejects on hook failure. No redirect logic belongs in these hooks.

Location observation starts in provider layout setup and immediately reconciles the current URL. Async initialization and auth-stage work use passive effects. Strict Mode shares work within a stage entry; leaving and entering again creates a new entry. Abandoned continuations do not update screens, navigate, or clear a later session. Host hook side effects already underway cannot be cancelled by the library, so make host work idempotent and avoid navigating from a pending hook.

Browser cache restoration uses one client-owned `pageshow` listener. It invalidates old initialization, refresh, callback, logout, and profile continuations, then re-reads credentials and verifies identity before resuming stage work. Terminal outcomes are retained so restored callback screens cannot repeat an exchange or logout. **Continue** retries only navigation; an explicit **Log in** or **Log out** starts new flow work.
