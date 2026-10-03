# Auth screens and composition

The library keeps PKCE, OAuth state checks, token exchange, storage, and stage navigation inside its own pages. Host views receive typed status, normalized errors, and library-owned recovery actions. Supply any subset of `LoginView`, `LoginCallbackView`, and `LogoutView`:

```tsx
import {
  AuthScreen,
  ReactAuthProvider,
  type LoginCallbackViewProps,
} from '@huddle-ai/auth';

function LoginCallbackView({ status, error, navigationError, onRetry, onContinue }: LoginCallbackViewProps) {
  return <AuthScreen>
    <p role={error === null ? 'status' : 'alert'}>
      {error?.message ?? (status === 'cancelled' ? 'Login was cancelled.' : status === 'complete' ? 'Login complete.' : 'Logging in…')}
    </p>
    {navigationError !== null && <p role="alert">{navigationError.message}</p>}
    {navigationError !== null && <button type="button" onClick={onContinue}>Continue</button>}
    {(status === 'cancelled' || status === 'error') && <button type="button" onClick={onRetry}>Log in</button>}
  </AuthScreen>;
}

<ReactAuthProvider client={authClient} views={{ LoginCallbackView }}>
  <App />
</ReactAuthProvider>
```

For a text change without a custom component, pass `messages={{ login: 'Connecting…', loginCallback: 'Signing you in…', logout: 'Closing session…' }}`. These replace the default progress messages only. Error and completion text still comes from the library. Custom views take full control of their markup.

`LoginViewProps.status` is `'redirecting' | 'cancelled' | 'error'`. `onRetry` is always present and handles its own error reporting through the login page. A history restoration to `/login` with a transaction no older than ten minutes shows cancellation; a fresh visit or in-app navigation still starts login automatically. Cancellation clears only the abandoned transaction, keeps the return path for retry, and does not invoke `onLoginError`. An expired transaction does not trigger cancellation.

```tsx
import { AuthScreen, type LoginViewProps } from '@huddle-ai/auth';

function LoginView({ status, error, onRetry }: LoginViewProps) {
  return <AuthScreen>
    <p role={error === null ? 'status' : 'alert'}>
      {error?.message ?? (status === 'cancelled' ? 'Login was cancelled. You can try again.' : 'Logging in…')}
    </p>
    {status === 'cancelled' && <button type="button" onClick={onRetry}>Log in</button>}
  </AuthScreen>;
}
```

In 0.2.0, all three view types include `'cancelled'` and a required, always-present `onRetry: () => void`. Add a cancellation case to exhaustive switches and supply the added fields wherever props are constructed manually. A state-validated `access_denied` callback is cancellation, with no `onLoginError` notification. Provider callback descriptions from the URL are never used as user-facing messages.

Callback and logout views also receive required `navigationError: AuthError | null` and `onContinue: () => void` props. `error` describes a flow failure; `navigationError` describes failed URL cleanup or return navigation. A successful flow remains `status: 'complete'` if navigation fails. **Continue** retries that navigation without repeating token exchange, logout cleanup, or flow hooks. **Log in** and **Log out** explicitly start fresh attempts. Actions handle rejected promises inside the library pages.

An interrupted provider logout is shown as cancelled/unconfirmed when an unexpired pending transaction is revisited without callback parameters. Its default text does not claim that a newer session was cleared. Expired or invalid callbacks remain errors; both error and cancellation views offer an explicit **Log out** retry. Terminal outcomes survive URL cleanup, reload, and bfcache restoration. A fresh login or explicit logout resets the relevant marker.

Lower-level integrations can call `authClient.retryLogin()` on login or callback routes and `authClient.retryLogout()` on logout routes, including a custom logout callback path. These methods coalesce concurrent calls; callback retries replace the auth route through the configured navigator and preserve the saved destination. Handle their rejected promises in your own UI.

`completeLogin(): Promise<LoginResult>` returns `{ status: 'complete', returnTo: string }` or `{ status: 'cancelled' }`. `completeLogout(): Promise<LogoutResult>` additionally supports `{ status: 'redirecting' }` and nullable completion return paths. Protocol failures still reject. Neither callback completion nor logout completion performs return navigation. Once a result is available, call `continueAuthStage(result.status === 'complete' ? result.returnTo : null)` for URL cleanup and return navigation; skip it for `redirecting`. If continuation rejects, retain the result and retry continuation instead of restarting authentication. The saved destination is consumed only after navigation commits.

The default views use `AuthScreen`. Its component-scoped CSS makes a neutral, centered, full-width page with a mobile viewport minimum height and safe-area padding. Set `--react-oauth-background-color` and `--react-oauth-text-color` on a parent to change default colors. `AuthScreen` accepts normal `<main>` props, including `className`; it does not reset `body` or `#root`. The host's root container must permit full available width and remove any default body margin. Long errors wrap and the page grows or scrolls rather than clipping them.

Auth stages replace the application subtree. To share an app theme with them, place the theme provider above the auth boundary. To compose the pieces separately:

```tsx
<AuthClientProvider client={authClient} navigation={navigation}>
  <HostLayout>
    <AuthBoundary messages={{ loginCallback: 'Signing you in…' }}>
      <App />
    </AuthBoundary>
  </HostLayout>
</AuthClientProvider>
```

Keep `HostLayout` free of app-only side effects that should stop during login. The boundary must remain mounted on auth URLs. `useAuthClient(authClient)` returns the client without subscribing to state. `useAuthStatus(authClient)` subscribes only to the authentication status; `useAuthProfile(authClient)` subscribes only to profile data. `useAuth(authClient)` returns the full snapshot and actions. Each hook checks that it is used under the matching client provider.

Providers sharing one client share location and bfcache listeners and must use the same adapter instance. The client revalidates stored session and identity data on restore, clears stale profile state, and invalidates old async work before resuming auth stages. Prefer one provider around the shared layout and compose boundaries beneath it.
