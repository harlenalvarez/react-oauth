# Project guidance

This repository is a client-side React OAuth library. Keep OAuth behavior based on React, TypeScript's built-in types, and browser APIs. Do not add utility, OAuth, JWT, crypto, or UI runtime dependencies or require host applications to install extra packages. Keep build, development, and test tools in development dependencies.

The library is intended to support the OAuth 2.0 authorization code flow with PKCE. Keep protocol processing, state and verifier handling, token storage, renewal, and validation inside the library. Host applications should be able to provide their own login, login-callback, and logout UI without replacing the security-sensitive callback logic.

## Component organization

- Use kebab-case directories for pages and components that own multiple artifacts.
- Keep a component's `.tsx`, sibling style file, `.test.tsx`, and component-specific hooks together in that directory.
- Lightweight atom components without dedicated styles or tests may remain colocated with their parent component.
- Keep library code under `src/lib`; keep runnable consumer examples separate from the package entry point.

## Styling

- Put non-trivial component styles in a sibling style file. Use plain CSS or CSS modules already supported by the project; do not add a styling dependency for the library.
- Prefer flexbox or grid for layout rather than margin-based positioning.
- Components should not hard-code their own layout width unless their contract requires it. Let parent containers control sizing.
- Use inline styles only for genuinely dynamic runtime values; move shared or repeated styles into a reusable class or component.
- Keep login, login-callback, and logout views replaceable by the consuming application. Keep login-callback validation and token-exchange behavior in library code.
- Use `/login`, `/login-callback`, and `/logout` as default paths; use `login`, `loginCallback`, and `logout` as config keys and `LoginView`, `LoginCallbackView`, and `LogoutView` as view names. Use “Log in,” “Logging in…,” and “Log out” in user-facing text.

## Components and React

- Use functional components.
- Target the React 19 version the project is on (see `package.json`) and prefer its current best practices and APIs (for example `use`, `useActionState`, `useTransition`, `useEffectEvent`, ref as a prop, context as a provider, ref cleanup functions) over legacy patterns such as `forwardRef` or `Context.Provider`. If an API requires a newer React than the `peerDependencies` minimum, raise the peer range deliberately rather than silently.
- Keep components small and focused. Isolate side effects into hooks or boundary components.
- Prefer pure helpers and deterministic render logic where possible to keep testing straightforward.
- Do not memoize by default. Add memoization only when render churn is measurable or the component contract clearly benefits from it.
- For repeated or memoized child components, avoid creating callbacks, objects, or arrays inline in JSX when they are passed as props. Use stable handlers and move static values or deterministic helpers to module scope. This does not prohibit local lambdas used only for transformations such as `map` or `filter`.
- Be deliberate about prop shape and state ownership to avoid unnecessary re-renders.

## Effects

- Use `useLayoutEffect` when the work must happen before paint **or before any other event can occur**. Layout effects run synchronously after DOM mutation and before the browser paints, so nothing can fire in the gap.
  - Registering listeners for events that could fire before a passive effect runs (for example `window` events such as `popstate`, `storage`, `message`, or `hashchange`) belongs in `useLayoutEffect`, so the listener is never registered too late and an event is never missed.
  - DOM measurement, URL synchronization, and reading or writing state that must be correct on the first painted frame also belong in `useLayoutEffect`.
- Use `useEffect` for everything else: ordinary side effects that can safely run after paint and cannot miss anything by running late, such as non-urgent data fetching, logging, or analytics.
- Always return a cleanup that removes whatever the effect registered.
- Both effect types are skipped during server rendering; do not rely on either for output that must exist in the initial HTML.

## Hook dependencies

- Do not blindly satisfy the dependency array. Decide what the hook is for and set dependencies to match that intent:
  - **Run-once setup:** the effect must not re-run no matter what changes (for example registering a listener or starting the initial auth check). Keep dependencies empty and read changing values through refs or `useEffectEvent`.
  - **Frequently changing value that should not re-render or re-subscribe:** keep it in a ref (or read it via `useEffectEvent`) instead of state or a dependency, so the latest value is available without extra renders or effect churn.
  - **Value the effect truly reacts to:** list it as a dependency.
- When a dependency is intentionally omitted, add a short comment explaining why, so the lint suppression is not mistaken for an oversight.
- Prefer stable inputs (primitives, module-scope constants, stable refs) over objects or functions created during render, which change identity every render and re-run effects.
- Update refs inside effects or event handlers, not during render.

## Performance

- Always consider what causes re-renders and avoid causing unnecessary ones. Every render creates new inline lambdas, objects, arrays, and functions defined inside the component body; to React these are new values, so any child, memoized value, or effect that receives them sees a change and re-renders or re-runs.
- Define pure functions and static values at module scope rather than inside the component. Only define a function inside a component when it must close over props, state, or refs, and then give it a stable identity (`useCallback`, a ref, or `useEffectEvent`) if it is passed to a child or used as a hook dependency.
- Keep state as local and as narrow as possible, and do not store derived values in state; compute them during render. Use refs for values that change often but do not affect what is rendered.
- Split context by update frequency so a frequently changing value does not re-render consumers that only need stable ones, and keep context values referentially stable.
- Prefer transitions (`useTransition`, `useDeferredValue`) for non-urgent updates rather than blocking the UI.
- This section refines, and does not override, the memoization rule above: do not sprinkle `memo`, `useMemo`, or `useCallback` everywhere, but do fix the identity churn that makes them necessary.

## Browser APIs and bundle size

- Keep the library light. Prefer the latest platform APIs over helper code or polyfills, as long as they are supported by current Chrome, Edge, Safari, and Firefox (check MDN or caniuse and confirm all four before using one).
- Do not add a polyfill or fallback for an API that is not yet available in all four browsers; either wait or feature-detect and degrade explicitly.
- Prefer native `URL`, `URLSearchParams`, `fetch`, `AbortController`, `crypto.subtle`, `structuredClone`, and `BroadcastChannel` over custom implementations.

## Typing

- Type every OAuth request, response, API payload, and mutation input.
- Prefer `type` aliases for DTO-shaped data, `interface` for extendable service contracts, and classes only when they provide useful behavior.
- For components with children, prefer `React.PropsWithChildren<T>` over manually redeclaring a `children` field.

## Browser APIs and OAuth

- Use browser APIs for cryptography, URL handling, network requests, and storage. Do not introduce third-party OAuth, JWT, or crypto helper packages into the published runtime.
- Use the authorization code grant with PKCE and SHA-256 (`S256`). Keep the verifier secret, validate the OAuth `state` on return, and follow the protocol's request encoding and redirect URI requirements.
- Treat browser storage and client-side token handling as security-sensitive. Do not describe encoding or obfuscation as secure token encryption.
- Keep access-token retrieval, refresh-token retrieval, renewal, and token validation explicit in the public API. Do not silently swallow network or protocol errors.
- Treat OAuth access tokens as opaque. Use token-response scope for granted-scope metadata. Use an app-owned profile loader or verified OpenID Connect ID-token claims for identity data; keep both separate from OAuth access-token validation.

## Versioning and releases

- Never edit the `version` field in `package.json` or `package-lock.json` by hand. The release command owns version bumps: `npm run release-tag -- patch|minor|major` reads the current version, bumps it, commits, tags, and pushes. A manual bump makes it publish the wrong version.
- Do not run `npm version`, create `v*` tags, or run `npm run release-tag` unless the user explicitly asks.
- Record user-facing changes in `CHANGELOG.md` under the upcoming version heading and in the README upgrade section when they are breaking. The heading names the version the release command will produce, but does not change `package.json`.
