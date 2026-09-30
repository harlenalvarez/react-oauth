# Restore the build and runnable consumer app

## User Story

As a library maintainer, I want the package to build and its local consumer app to start so that each later OAuth flow can be developed and inspected in a browser.

## Business Outcome

- `npm run build` produces the package's JavaScript and declarations, and `npm start` serves a small consumer app.
- The published package has no `@practicaljs/ts-kit` dependency or broken user-service stub.

## Domain Context

- **Bounded Context:** OAuth package foundation and developer experience.
- **Primary Capability:** A working package and local application entry point.
- **Existing Artifacts Involved:** Vite library build, `OauthProvider`, `OauthConfig`, token-response guard calls, root demo, package exports.
- **New or Updated Artifacts Likely Needed:** No new OAuth domain artifacts expected. A small local response guard may be needed while removing `isType`.

## Codebase Evidence

- `package.json`, `vite.config.ts`, `tsconfig.json`, and `tsconfig.node.json` - `build` runs `tsc` before Vite; TypeScript 7 rejects the current module-resolution and interop options. Vite dev startup currently fails to load the installed SWC native binding.
- `src/lib/types/config.type.ts` and `src/lib/services/oauth-response/OauthResponse.ts` - the only production imports of `@practicaljs/ts-kit` are `Optional` and `isType`.
- `src/lib/components/provider/UserProvider.tsx`, `src/lib/context/UserContext.tsx`, and `src/lib/services/token/tokenService.test.ts` - unfinished or invalid stubs prevent a clean source type check.
- `src/main.tsx` and `src/App.tsx` - an app entry exists but still shows starter content and uses placeholder OAuth endpoints.

## File Touch Plan

| Path | Change | Reason |
| --- | --- | --- |
| `package.json`, `package-lock.json` | update | Remove `@practicaljs/ts-kit`; keep React as the only library peer/runtime requirement and React DOM as a local demo dependency; remove package lifecycle scripts that mutate tracked `package.json` if unnecessary. |
| `tsconfig.json`, `tsconfig.node.json` | update | Use compiler options accepted by the installed TypeScript version and appropriate for Vite and package declarations. |
| `vite.config.ts` | update | Preserve the library entry and React externals while resolving the SWC startup problem and separating dev app versus package output. |
| `src/lib/types/config.type.ts` | update | Replace `Optional` with built-in TypeScript types and remove avoidable `any` casts. |
| `src/lib/services/oauth-response/OauthResponse.ts`, `src/lib/services/oauth-response/OauthResponse.test.ts` | update | Replace `isType` with a local check of unknown JSON, pending the full response contract in story 3. |
| `src/lib/components/provider/UserProvider.tsx`, `src/lib/context/UserContext.tsx`, `src/lib/types/jsonWebToken.ts`, `src/lib/services/token/tokenService.ts`, `src/lib/services/token/tokenService.test.ts` | remove | Remove unused user/JWT types and empty token-service stubs; story 4 creates the real token service. |
| `src/lib/context/index.ts`, `src/lib/types/index.ts`, `src/lib/index.ts` | update | Remove exports and imports for deleted stubs and confirm a clean package entry. |
| `src/App.tsx`, `src/App.css`, `src/index.css`, `index.html`, `README.md` | update | Replace starter branding with a small, typed consumer shell and document local commands and current demo limits. |
| `test.setup.ts` | verify | Keep browser API mocks limited to what the existing tests need after toolchain repair. |

## Technical Implementation Plan

### Vertical Slice Summary

A maintainer installs from the lockfile, starts Vite, sees a local consumer shell, runs a package build, and can import its public entry without TypeScript or module-resolution errors.

### Entry Points and Orchestration

Keep `src/main.tsx` as the dev app entry and `src/lib/index.ts` as the package entry. Make the demo visibly identify itself as an OAuth consumer fixture. Auth flow controls can remain disabled or explanatory until stories 2 and 3 provide real endpoints.

### Domain and Application Changes

No new auth behavior. Replace the utility type with standard `Omit`/`Pick`/`Partial` composition and narrow unknown JSON before checking an OAuth error field. Remove `UserProvider`, `UserContext`, and the empty `TokenService` pending the auth-state API in story 4.

### API, UI, Output, or Infrastructure Changes

Repair both TypeScript configs; run a clean `npm ci` to restore the optional SWC native binary, and if that still fails, adjust the existing Vite setup without adding a runtime package. Inspect `dist` declarations and JavaScript after building. Keep React external to the published bundle; do not import React DOM from library code. The demo uses React DOM to mount a working root route.

### Data, Contracts, and Edge Cases

Keep the current exported names until later stories define the new public API, unless a name is unusable due to a compiler error. Remove the dependency with `npm uninstall @practicaljs/ts-kit`. Ensure `npm pack --dry-run` contains the expected `dist` entry and types after package scripts have stopped mutating source files.

### Testing and Validation Plan

- `src/lib/types/config.type.test.ts` - config defaults and required values still work without `Optional`.
- `src/lib/services/oauth-response/OauthResponse.test.ts` - malformed and `null` JSON do not pass as valid token responses.
- `src/lib/components/provider/OauthProvider.test.tsx` - the provider still renders children in the demo shell.
- Validation commands: `npm ci`, `npm run build`, `npm run test:deploy`, `npm start`, `npm pack --dry-run`, and `npm ls @practicaljs/ts-kit`.

## Dependency & Package Requirements

No new packages required. Remove the existing utility package with `npm uninstall @practicaljs/ts-kit`; retain build and test packages only as development tools.

## Assumptions & Open Questions

- The SWC startup failure may come from this checkout's installed optional binary/cache rather than the Vite config; determine that from a clean install before changing plugins.
- The current package is private and unreleased at version `0.0.0`, so later stories may rename its public API without a compatibility alias.

## Acceptance Criteria

- A clean install can run the Vite app and load its root page.
- The package build emits importable JavaScript and matching declarations; the configured package paths resolve.
- Source, lockfile, and pack output no longer require `@practicaljs/ts-kit`, and no unfinished user/token stub blocks type checking.
