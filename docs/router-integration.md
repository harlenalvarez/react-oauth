# Router integration

The default navigator uses `history.pushState()` for login/logout entry and `history.replaceState()` when leaving an auth screen. It then dispatches `popstate`. Your own helper that calls `pushState()` and dispatches `popstate` can therefore enter an auth screen without reloading the document. Native Back/Forward events work too.

React Router and TanStack Router also have their own location subscriptions. To recognize **their** Link and navigate calls reliably, pass a complete adapter to the provider. It supplies the current committed `pathname + search + hash`, announces changes, and navigates through the router. Keep its bridge mounted above the auth boundary, including on `/login`, `/login-callback`, and `/logout`. The server must serve the app at the callback URL so the authorization server can return there.

```ts
interface AuthNavigationAdapter {
  navigate(options: { readonly to: string; readonly replace: boolean }): void | Promise<void>;
  getLocation(): string;
  subscribe(listener: () => void): () => void;
}
```

The adapter owns internal history and notifications. The library does not dispatch a second `popstate` when an adapter is installed. A rejected navigation rejects the calling auth action. An adapter should report only committed locations; a blocked navigation should leave the prior URL in place.

## React Router

Save this adapter as `src/react-router.tsx` in the host app. It uses `useLocation()` to announce committed router changes and `useNavigate()` for library navigation:

```tsx
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AuthNavigationAdapter } from '@huddle-ai/auth';

export function useReactRouterAuthNavigation(basename = '/'): AuthNavigationAdapter {
  const location = useLocation();
  const navigate = useNavigate();
  const base = basename === '/' ? '' : `/${basename.replace(/^\/+|\/+$/g, '')}`;
  const path = `${base}${location.pathname}${location.search}${location.hash}`;
  const current = useRef(path);
  const listeners = useRef(new Set<() => void>());

  useLayoutEffect(() => {
    if (current.current === path) return;
    current.current = path;
    listeners.current.forEach((listener) => listener());
  }, [path]);

  return useMemo(() => ({
    navigate: ({ to, replace }) => {
      const target = new URL(to, window.location.origin);
      if (base !== '' && target.pathname !== base && !target.pathname.startsWith(`${base}/`)) {
        throw new Error('Auth navigation must stay inside the router basename.');
      }
      const pathname = target.pathname.slice(base.length) || '/';
      navigate(`${pathname}${target.search}${target.hash}`, { replace });
    },
    getLocation: () => current.current,
    subscribe: (listener) => {
      listeners.current.add(listener);
      return () => { listeners.current.delete(listener); };
    },
  }), [navigate, base]);
}
```

Place its bridge inside `BrowserRouter` and above `ReactAuthProvider`:

```tsx
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ReactAuthProvider } from '@huddle-ai/auth';
import { authClient } from './auth';
import { useReactRouterAuthNavigation } from './react-router'; // The host adapter above.
import { Home } from './Home';
import { Projects } from './Projects';
import { ThemeProvider } from './theme'; // Your existing app theme.

function AuthShell() {
  const navigation = useReactRouterAuthNavigation();
  return (
    <ReactAuthProvider client={authClient} navigation={navigation}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects/*" element={<Projects />} />
        <Route path="/login" element={<span />} />
        <Route path="/login-callback" element={<span />} />
        <Route path="/logout" element={<span />} />
      </Routes>
    </ReactAuthProvider>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root');
createRoot(root).render(
  <BrowserRouter>
    <ThemeProvider>
      <AuthShell />
    </ThemeProvider>
  </BrowserRouter>,
);
```

Use the router already installed in your host app. The placeholder auth routes keep the router's route tree complete; `ReactAuthProvider` owns their UI and behavior. A host `<Link to="/login">` is handled through the adapter's location subscription. This example targets React Router's browser router; use its equivalent location and navigate APIs for another router mode.

## TanStack Router

Save this adapter as `src/tanstack-router.ts` in the host app:

```ts
import type { AnyRouter } from '@tanstack/react-router';
import type { AuthNavigationAdapter } from '@huddle-ai/auth';

export function adaptTanStackRouter(router: AnyRouter): AuthNavigationAdapter {
  return {
    // href is the public app path; the router translates its configured basepath.
    navigate: ({ to, replace }) => router.navigate({ href: to, replace }),
    getLocation: () => {
      const { pathname, search, hash } = router.history.location;
      return `${pathname}${search}${hash}`;
    },
    subscribe: (listener) => router.history.subscribe(listener),
  };
}
```

It uses `router.history.location`, `router.history.subscribe`, and `router.navigate({ href, replace })`. The relative `href` preserves the public pathname, query, and hash while letting the router translate its basepath. Pass the same router instance to `RouterProvider` and the adapter. Put the auth provider in a persistent root route component with an `<Outlet />` as its app child. Define matching child routes for all auth paths, including any explicit callback path:

```tsx
import { createRoot } from 'react-dom/client';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { ReactAuthProvider } from '@huddle-ai/auth';
import { authClient } from './auth';
import { adaptTanStackRouter } from './tanstack-router'; // The host adapter above.
import { Home } from './Home';
import { ThemeProvider } from './theme'; // Your existing app theme.

function RootRouteView() {
  return (
    <ThemeProvider>
      <ReactAuthProvider client={authClient} navigation={navigation}>
        <Outlet />
      </ReactAuthProvider>
    </ThemeProvider>
  );
}

const rootRoute = createRootRoute({ component: RootRouteView });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home });
const authRoutes = ['/login', '/login-callback', '/logout'].map((path) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
);
const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, ...authRoutes]) });
const navigation = adaptTanStackRouter(router);

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root');
createRoot(root).render(<RouterProvider router={router} />);
```

The fixtures currently test React Router 6.2.1 and TanStack Router 1.170.36. They live under `dev/` and are development dependencies only. Copy the appropriate adapter into an app that already uses that router; adapters are not exported by the library. For routers with blockers, make rejected or cancelled navigation reject the adapter's promise rather than announcing an uncommitted location.

For an app under `/workspace/`, set `appBaseUrl: 'https://app.example.com/workspace/'`. Default auth paths resolve under that base. Set React Router's `<BrowserRouter basename="/workspace">` and call `useReactRouterAuthNavigation('/workspace')` with the same basename. For TanStack Router, set `basepath: '/workspace'` when creating the router; its adapter translates public paths automatically. Keep route definitions relative to the router root. Register the exact callback URL with the authorization server. An explicit `redirectUri` may choose another path served by the app, but it must also match a persistent router shell. Internal navigation must remain on the current origin.

On an auth stage, the boundary replaces its app children. Router/theme providers above it remain mounted. If a router unmounts the boundary for auth paths, move it to the router's persistent shell. For a lower-level composition, use `AuthClientProvider` outside your layout and `AuthBoundary` around the section that should switch between the app and auth screens.
