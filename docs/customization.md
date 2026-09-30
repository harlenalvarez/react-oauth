# Auth screens and composition

The library keeps PKCE, OAuth state checks, token exchange, storage, and stage navigation inside its own pages. A host view only receives typed status and a normalized error. Supply any subset of `LoginView`, `LoginCallbackView`, and `LogoutView`:

```tsx
import {
  AuthScreen,
  ReactAuthProvider,
  type LoginCallbackViewProps,
} from '@huddle-ai/auth';

function LoginCallbackView({ error }: LoginCallbackViewProps) {
  return <AuthScreen><p role={error === null ? 'status' : 'alert'}>
    {error?.message ?? 'Signing you in…'}
  </p></AuthScreen>;
}

<ReactAuthProvider client={authClient} views={{ LoginCallbackView }}>
  <App />
</ReactAuthProvider>
```

For a text change without a custom component, pass `messages={{ login: 'Connecting…', loginCallback: 'Signing you in…', logout: 'Closing session…' }}`. These replace the default progress messages only. Error and completion text still comes from the library. Custom views take full control of their markup.

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

Providers sharing one client share one location listener and must use the same adapter instance. Prefer one provider around the shared layout and compose boundaries beneath it.
