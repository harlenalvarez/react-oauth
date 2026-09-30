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
- Use `useLayoutEffect` only when an effect must run before paint, such as DOM measurement or URL synchronization. Use `useEffect` by default for ordinary side effects.
- Keep components small and focused. Isolate side effects into hooks or boundary components.
- Prefer pure helpers and deterministic render logic where possible to keep testing straightforward.
- Do not memoize by default. Add memoization only when render churn is measurable or the component contract clearly benefits from it.
- For repeated or memoized child components, avoid creating callbacks, objects, or arrays inline in JSX when they are passed as props. Use stable handlers and move static values or deterministic helpers to module scope. This does not prohibit local lambdas used only for transformations such as `map` or `filter`.
- Be deliberate about prop shape and state ownership to avoid unnecessary re-renders.

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
