import { useLayoutEffect, useMemo } from 'react';
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { BrowserRouter, Link as ReactRouterLink } from 'react-router-dom';
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link as TanStackLink,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { createAuthClient, ReactAuthProvider } from '@huddle-ai/auth';
import type { AuthNavigationAdapter } from '@huddle-ai/auth';
import { useReactRouterAuthNavigation } from './react-router';
import { adaptTanStackRouter } from './tanstack-router';

function defer() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeClient(onLogoutStart: () => Promise<void>) {
  return createAuthClient({
    clientId: `router-${crypto.randomUUID()}`,
    authorizationEndpoint: 'https://identity.example.com/authorize',
    tokenEndpoint: 'https://identity.example.com/token',
    hooks: { onLogoutStart },
  });
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it('React Router Link enters the auth boundary and library navigation returns through the router', async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  const pending = defer();
  const client = makeClient(() => pending.promise);
  function Home(): ReactElement {
    return <ReactRouterLink to="/logout">Log out through React Router</ReactRouterLink>;
  }
  function Shell(): ReactElement {
    const navigation = useReactRouterAuthNavigation();
    return <ReactAuthProvider client={client} navigation={navigation}><Home /></ReactAuthProvider>;
  }
  render(<BrowserRouter><Shell /></BrowserRouter>);
  fireEvent.click(screen.getByText('Log out through React Router'));
  expect(await screen.findByRole('status')).toHaveTextContent('Logging out…');
  pending.resolve();
  await waitFor(() => expect(screen.getByText('Log out through React Router')).toBeInTheDocument());
  expect(window.location.pathname).toBe('/');
});

it('TanStack Router Link enters the auth boundary and library navigation returns through the router', async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  const pending = defer();
  const client = makeClient(() => pending.promise);
  const root = createRootRoute({ component: Shell });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: Home });
  const logout = createRoute({ getParentRoute: () => root, path: '/logout', component: () => <span>Uncontrolled logout route</span> });
  const router = createRouter({ routeTree: root.addChildren([home, logout]), history: createBrowserHistory() });
  const navigation = adaptTanStackRouter(router);

  function Shell(): ReactElement {
    return <ReactAuthProvider client={client} navigation={navigation}><Outlet /></ReactAuthProvider>;
  }
  function Home(): ReactElement {
    return <TanStackLink to="/logout">Log out through TanStack Router</TanStackLink>;
  }

  const mounted = render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByText('Log out through TanStack Router'));
  expect(await screen.findByRole('status')).toHaveTextContent('Logging out…');
  pending.resolve();
  await act(async () => { await pending.promise; });
  await waitFor(() => expect(screen.getByText('Log out through TanStack Router')).toBeInTheDocument());
  expect(window.location.pathname).toBe('/');
  mounted.unmount();
  router.history.destroy();
});

describe.each(['React Router', 'TanStack Router'] as const)('%s complete integration', (kind) => {
  it.each(['', '/workspace'])('handles login, traversal, callback, logout, and cleanup under base %s', async (basePath) => {
    vi.stubGlobal('scrollTo', vi.fn());
    window.history.replaceState(null, '', `${basePath}/`);
    const onLoginStart = vi.fn(() => new Promise<void>(() => undefined));
    const client = createAuthClient({
      clientId: `complete-router-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      appBaseUrl: `${window.location.origin}${basePath}/`,
      hooks: { onLoginStart },
    });
    const stops: ReturnType<typeof vi.fn>[] = [];
    function track(adapter: AuthNavigationAdapter): AuthNavigationAdapter {
      return {
        ...adapter,
        subscribe: (listener) => {
          const stop = vi.fn(adapter.subscribe(listener));
          stops.push(stop);
          return stop;
        },
      };
    }
    let navigate: AuthNavigationAdapter['navigate'] = () => { throw new Error('Router not mounted'); };
    function Home(): ReactElement {
      return kind === 'React Router'
        ? <ReactRouterLink to="/login">Host login</ReactRouterLink>
        : <TanStackLink to="/login">Host login</TanStackLink>;
    }
    function ReactShell(): ReactElement {
      const source = useReactRouterAuthNavigation(basePath || '/');
      const adapter = useMemo(() => track(source), [source]);
      useLayoutEffect(() => { navigate = adapter.navigate; }, [adapter]);
      return <ReactAuthProvider client={client} navigation={adapter}><Home /></ReactAuthProvider>;
    }
    const root = createRootRoute({ component: TanStackShell });
    const routes = ['/', '/projects', '/login', '/login-callback', '/logout'].map((path) =>
      createRoute({ getParentRoute: () => root, path, component: Home }),
    );
    const router = createRouter({
      routeTree: root.addChildren(routes),
      basepath: basePath || '/',
      history: kind === 'TanStack Router' ? createBrowserHistory() : createMemoryHistory({ initialEntries: ['/'] }),
    });
    const tanStackAdapter = track(adaptTanStackRouter(router));
    function TanStackShell(): ReactElement {
      return <ReactAuthProvider client={client} navigation={tanStackAdapter}><Outlet /></ReactAuthProvider>;
    }
    const mounted = kind === 'React Router'
      ? render(<BrowserRouter basename={basePath || '/'}><ReactShell /></BrowserRouter>)
      : render(<RouterProvider router={router} />);
    if (kind === 'TanStack Router') navigate = tanStackAdapter.navigate;

    fireEvent.click(await screen.findByText('Host login'));
    expect(await screen.findByRole('status')).toHaveTextContent('Logging in…');
    await waitFor(() => expect(onLoginStart).toHaveBeenCalledTimes(1));
    await act(async () => { await navigate({ to: `${basePath}/projects?tab=activity#notes`, replace: false }); });
    expect(await screen.findByText('Host login')).toBeInTheDocument();
    window.history.back();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Logging in…'));
    window.history.forward();
    await waitFor(() => expect(screen.getByText('Host login')).toBeInTheDocument());

    client.transactions.save({ clientId: client.config.clientId, state: 'expected', verifier: 'secret', createdAt: Date.now() });
    client.transactions.saveReturnTo(`${basePath}/projects?tab=activity#notes`);
    const exchange = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'router-access', token_type: 'Bearer', expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', exchange);
    await act(async () => { await navigate({ to: `${basePath}/login-callback?code=sample&state=expected`, replace: false }); });
    await waitFor(() => expect(client.getSnapshot().status).toBe('authenticated'));
    await waitFor(() => expect(window.location.pathname + window.location.search + window.location.hash).toBe(`${basePath}/projects?tab=activity#notes`));
    expect(exchange).toHaveBeenCalledTimes(1);

    await act(async () => { await client.logout(); });
    await waitFor(() => expect(window.location.pathname).toBe(`${basePath}/`));
    expect(client.storage.getRecord()).toBeNull();
    mounted.unmount();
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    router.history.destroy();
  });
});

it('React Router completes provider logout on an explicit callback below its basename', async () => {
  const callbackUri = `${window.location.origin}/workspace/session-ended`;
  window.history.replaceState(null, '', '/workspace/session-ended?state=expected');
  const client = createAuthClient({
    clientId: `react-provider-${crypto.randomUUID()}`,
    authorizationEndpoint: 'https://identity.example.com/authorize',
    tokenEndpoint: 'https://identity.example.com/token',
    endSessionEndpoint: 'https://identity.example.com/end-session',
    appBaseUrl: `${window.location.origin}/workspace/`,
    postLogoutRedirectUri: callbackUri,
  });
  sessionStorage.setItem(`react-oauth:logout:${encodeURIComponent(client.config.clientId)}`, JSON.stringify({
    status: 'pending', callbackUri, state: 'expected', createdAt: Date.now(),
  }));
  function Shell() {
    const navigation = useReactRouterAuthNavigation('/workspace');
    return <ReactAuthProvider client={client} navigation={navigation}><span>Host</span></ReactAuthProvider>;
  }
  render(<BrowserRouter basename="/workspace"><Shell /></BrowserRouter>);
  expect(await screen.findByText('Logged out.')).toBeInTheDocument();
  await waitFor(() => expect(window.location.search).toBe(''));
  expect(window.location.pathname).toBe('/workspace/session-ended');
  expect(screen.queryByText('Host')).not.toBeInTheDocument();
});

it('TanStack Router completes provider logout on an explicit callback below its basepath', async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  const callbackUri = `${window.location.origin}/workspace/session-ended`;
  window.history.replaceState(null, '', '/workspace/session-ended?state=expected');
  const client = createAuthClient({
    clientId: `tanstack-provider-${crypto.randomUUID()}`,
    authorizationEndpoint: 'https://identity.example.com/authorize',
    tokenEndpoint: 'https://identity.example.com/token',
    endSessionEndpoint: 'https://identity.example.com/end-session',
    appBaseUrl: `${window.location.origin}/workspace/`,
    postLogoutRedirectUri: callbackUri,
  });
  sessionStorage.setItem(`react-oauth:logout:${encodeURIComponent(client.config.clientId)}`, JSON.stringify({
    status: 'pending', callbackUri, state: 'expected', createdAt: Date.now(),
  }));
  function Shell() {
    return <ReactAuthProvider client={client} navigation={navigation}><Outlet /></ReactAuthProvider>;
  }
  const root = createRootRoute({ component: Shell });
  const callback = createRoute({ getParentRoute: () => root, path: '/session-ended', component: () => <span>Host</span> });
  const router = createRouter({ basepath: '/workspace', routeTree: root.addChildren([callback]), history: createBrowserHistory() });
  const navigation = adaptTanStackRouter(router);
  const mounted = render(<RouterProvider router={router} />);
  expect(await screen.findByText('Logged out.')).toBeInTheDocument();
  await waitFor(() => expect(window.location.search).toBe(''));
  expect(window.location.pathname).toBe('/workspace/session-ended');
  expect(screen.queryByText('Host')).not.toBeInTheDocument();
  mounted.unmount();
  router.history.destroy();
});
