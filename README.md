# @huddle-ai/auth

A client-side React library for the OAuth 2.0 authorization-code flow with PKCE. The library owns login callback validation, token exchange and renewal, optional provider session logout, scoped token storage, and the optional verification of OpenID Connect ID tokens. A consuming app supplies its provider endpoints and can replace the login, login-callback, and logout views.

Install the public package after its first release:

```sh
npm install @huddle-ai/auth
```

The package ships ESM for modern Vite applications. React and its JSX runtime stay external, and built-in component styles load automatically; no separate CSS import is required.

See the [getting-started guide](docs/getting-started.md) for the public API and the [project status](docs/project-status.md) for implementation scope and validation.

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
