# Changelog

## 0.2.0

Upgrading from 0.1.1? See [Upgrading from 0.1.1 to 0.2.0](README.md#upgrading-from-011-to-020) for a short checklist.

### Breaking changes

- `LoginViewProps.status` now includes `'cancelled'`, and `LoginViewProps.onRetry` is a required, always-present `() => void` callback. Custom login views must handle the added status, including exhaustive switches, and any manually constructed props must include `onRetry`. See [customization](docs/customization.md) for an example.
- Callback and logout view props add `'cancelled'`, required `onRetry`, `navigationError`, and `onContinue`. `LogoutResult` now includes `cancelled`.
- `completeLogin()` returns the exported `LoginResult` union (`complete` with `returnTo`, or `cancelled`) instead of a string.
- `completeLogout()` performs protocol processing without URL cleanup. Lower-level consumers must call `continueAuthStage(returnTo)` after completion (or with `null` for cancellation/cleanup only). Library pages handle this automatically. Callback return paths are retained until committed navigation; lower-level login consumers should also use `continueAuthStage()`.
- `onLoginCallbackStart` now runs after the callback response and `state` are validated, not before. Replayed completed or cancelled outcomes do not run it again.
- `onLoginError` is no longer called when the user cancels (browser Back or a verified provider `access_denied`). `onLogoutError` is no longer called for an interrupted provider logout, which previously failed with `INCOMPLETE_PROVIDER_LOGOUT` and now shows the cancelled state.

### Changes

- Returning from the authorization server with browser Back now shows a cancelled login screen when an unexpired PKCE transaction exists. This includes back/forward cache restoration. Fresh in-app login navigation still starts authorization automatically.
- The default cancelled view offers a **Log in** button. Retrying creates a fresh PKCE transaction and keeps the original return path. Concurrent retry calls share one attempt.
- A state-validated provider `access_denied` callback now produces cancellation with **Log in** recovery. Other callback errors use library-owned messages; the provider's `error_description` is no longer shown. Malformed or mismatched callbacks preserve the genuine transaction and existing session.
- Interrupted provider logout now shows an unconfirmed/cancelled state with **Log out** recovery. Terminal cancellation, failure, and completion markers prevent reload from repeating authentication work. Explicit retries coalesce, preserve return destinations, and restore logout markers if router navigation fails.
- Completed login/logout now report URL cleanup or return-navigation failures separately through `navigationError`. **Continue** retries navigation only, with the destination retained across reload.
- One client-owned back/forward cache listener re-reads stored credentials, revalidates OIDC identity, reloads the current profile, and invalidates frozen asynchronous work. Removed or expired credentials no longer leave a restored protected page authenticated.
- The default login progress message is now “Logging in…”.
