# @huddle-ai/auth

A client-side React library for the OAuth 2.0 authorization-code flow with PKCE. The library owns login callback validation, token exchange and renewal, optional provider session logout, scoped token storage, and the optional verification of OpenID Connect ID tokens. A consuming app supplies its provider endpoints and can replace the login, login-callback, and logout views.

Install the package:

```sh
npm install @huddle-ai/auth
```

The package ships ESM for modern Vite applications. React and its JSX runtime stay external, and built-in component styles load automatically; no separate CSS import is required.

See the [getting-started guide](docs/getting-started.md) for the public API and the [project status](docs/project-status.md) for implementation scope and validation. Release notes are in the [changelog](CHANGELOG.md).

## Upgrading from 0.1.1 to 0.2.0

Version 0.2.0 handles interrupted sign-ins: browser Back from the identity provider, a provider `access_denied` response, and an abandoned provider logout now show a cancelled screen with a **Log in** or **Log out** button instead of restarting or showing a dead-end error. The [changelog](CHANGELOG.md) lists every change. If you use the default views and the page components, you do not need to change anything. Otherwise, check these:

1. **Custom views (`views.LoginView`, `LoginCallbackView`, `LogoutView`).** All three view props gain a `'cancelled'` status and a required `onRetry: () => void`. Add the new case to any exhaustive `switch` and render a retry button when `status` is `'cancelled'` or `'error'`. `LoginCallbackView` and `LogoutView` also receive `navigationError: AuthError | null` and `onContinue: () => void`; render a **Continue** button when `navigationError` is not `null`. If you build these props by hand in tests or Storybook, add the new fields. See [customization](docs/customization.md) for a complete example.
2. **Lifecycle hooks.** `onLoginCallbackStart` now runs after the response and `state` are validated, not before. `onLoginError` and `onLogoutError` are not called for cancellations (Back, `access_denied`, an unconfirmed provider logout). See [lifecycle](docs/lifecycle.md).
3. **Direct calls to `completeLogin()` or `completeLogout()`.** Skip this if you use the library's pages. `completeLogin()` now returns a `LoginResult` object (`{ status: 'complete', returnTo }` or `{ status: 'cancelled' }`) instead of a string. `completeLogout()` can also return `{ status: 'cancelled' }`. Neither cleans up the callback URL or navigates any more; call `continueAuthStage(returnTo)` afterward, or `continueAuthStage(null)` for a cancellation, and skip it for `{ status: 'redirecting' }`.
4. **Text assertions.** The default login message changed from “Taking you to log in…” to “Logging in…”, and provider `error_description` text is no longer shown to users.

Configuration, routes, and token storage are unchanged.

## Run the local consumer fixture

Use two terminals:

```sh
npm run dev:mock
npm start
```

Open the Vite URL, then use **Log in**, load the protected project, renew the token, and **Log out**. Logout round-trips through the fixture’s end-session endpoint and stays on the completion page; navigate home to log in again. The fixture uses fake credentials and a locally generated RSA signing key. It is development infrastructure and is not included in the package.

## Package and tests

```sh
npm run build
npm run test:deploy
npm run test:release
npm run check:router-examples
npm run check:package
```

The package is configured for public npm publication. See [releasing](docs/releasing.md) for the first local publication and automated tag releases. React 19 or later is the only runtime peer dependency; build, router examples, and test tools are development dependencies. Internal auth navigation stays in the current document; the authorization server redirect and callback return still use browser navigation.

## Release a new version

Commit your changes on `main` and make sure your working tree is clean and includes the latest changes from `origin/main`. Then run:

```sh
npm run release-tag
```

The command bumps the patch version in both package files, creates the release commit, pushes `main`, and creates and pushes the matching `vX.Y.Z` tag. You do not need to enter the version or tag yourself. GitHub Actions runs the release checks and publishes to npm under `latest`; check the **Publish to npm** workflow in GitHub Actions for the result.

For a larger version bump, run one of these instead:

```sh
npm run release-tag -- minor
npm run release-tag -- major
```

If a command fails, follow the recovery commands printed by the script instead of rerunning the version bump. See the [release guide](docs/releasing.md) for setup and troubleshooting.
