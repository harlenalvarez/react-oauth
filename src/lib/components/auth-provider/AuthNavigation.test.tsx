import { StrictMode, useLayoutEffect } from 'react';
import type { ReactElement } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthClient } from '@/services/auth-client/AuthClient';
import type { AuthClientOptions, AuthNavigationAdapter } from '@/types';
import { AuthClientProvider } from './AuthClientProvider';
import { AuthBoundary } from './AuthBoundary';
import { ReactAuthProvider } from './ReactAuthProvider';

function makeClient(options: Partial<AuthClientOptions> = {}) {
  return createAuthClient({
    clientId: `route-${crypto.randomUUID()}`,
    authorizationEndpoint: 'https://identity.example.com/authorize',
    tokenEndpoint: 'https://identity.example.com/token',
    ...options,
  });
}

function defer() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('SPA auth navigation', () => {
  it('observes events during layout setup without a boundary and removes the listener on cleanup', () => {
    const client = makeClient();
    const listeners = new Set<() => void>();
    let location = '/';
    const adapter: AuthNavigationAdapter = {
      navigate: () => undefined,
      getLocation: () => location,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    };
    function LayoutNavigation(): ReactElement {
      useLayoutEffect(() => {
        expect(listeners.size).toBe(1);
        location = '/logout';
        listeners.forEach((listener) => listener());
        expect(client.getAuthRouteSnapshot().stage).toBe('logout');
      }, []);
      return <span>Sibling</span>;
    }
    const mounted = render(<>
      <AuthClientProvider client={client} navigation={adapter}><span>App</span></AuthClientProvider>
      <LayoutNavigation />
    </>);
    expect(listeners.size).toBe(1);
    mounted.unmount();
    expect(listeners.size).toBe(0);
  });

  it('reconciles a navigation emitted by a child before provider layout setup', () => {
    const client = makeClient({ hooks: { onLogoutStart: () => new Promise<void>(() => undefined) } });
    function NavigateOnMount(): ReactElement {
      useLayoutEffect(() => {
        window.history.pushState(null, '', '/logout');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, []);
      return <span>App</span>;
    }
    render(<ReactAuthProvider client={client}><NavigateOnMount /></ReactAuthProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Logging out…');
  });

  it('shares one location subscription across providers and keeps it until the last cleanup', () => {
    const client = makeClient();
    const listeners = new Set<() => void>();
    let location = '/';
    const adapter: AuthNavigationAdapter = {
      navigate: () => undefined,
      getLocation: () => location,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    };
    const first = render(<AuthClientProvider client={client} navigation={adapter}><span>First</span></AuthClientProvider>);
    const second = render(<AuthClientProvider client={client} navigation={adapter}><span>Second</span></AuthClientProvider>);
    expect(listeners.size).toBe(1);
    first.unmount();
    expect(listeners.size).toBe(1);
    location = '/login';
    listeners.forEach((listener) => listener());
    expect(client.getAuthRouteSnapshot().stage).toBe('login');
    second.unmount();
    expect(listeners.size).toBe(0);
  });

  it('rejects a configured app origin different from the current browser origin', async () => {
    const client = makeClient({ appBaseUrl: 'https://other.example.com/' });
    const push = vi.spyOn(window.history, 'pushState');
    await expect(client.acquireToken()).rejects.toThrow('Internal auth navigation');
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it('does not start login when a pending token read finishes after departure', async () => {
    const pending = defer();
    const client = makeClient();
    vi.spyOn(client, 'getToken').mockImplementation(async () => { await pending.promise; return null; });
    const start = vi.spyOn(client, 'startLogin');
    render(<ReactAuthProvider client={client}><span>App</span></ReactAuthProvider>);
    await act(async () => { await client.acquireToken(); });
    act(() => {
      window.history.pushState(null, '', '/projects');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    pending.resolve();
    await act(async () => { await pending.promise; });
    expect(start).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/projects');
  });

  it('does not clear a later session when an abandoned logout hook finishes', async () => {
    const pending = defer();
    const client = makeClient({ hooks: { onLogoutStart: () => pending.promise } });
    render(<ReactAuthProvider client={client}><span>App</span></ReactAuthProvider>);
    await act(async () => { await client.logout(); });
    act(() => {
      window.history.pushState(null, '', '/projects');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    client.storage.save({ accessToken: 'later-session', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    pending.resolve();
    await act(async () => { await pending.promise; });
    expect(client.storage.getRecord()?.accessToken).toBe('later-session');
    expect(window.location.pathname).toBe('/projects');
  });

  it('starts a new callback entry when departure and reentry are batched, without scrubbing the new URL', async () => {
    const pending = defer();
    const onLoginCallbackStart = vi.fn(() => new Promise<void>(() => undefined))
      .mockImplementationOnce(() => pending.promise);
    const client = makeClient({ hooks: { onLoginCallbackStart } });
    window.history.replaceState(null, '', '/login-callback?code=first&state=first');
    render(<ReactAuthProvider client={client}><span>App</span></ReactAuthProvider>);
    expect(onLoginCallbackStart).toHaveBeenCalledTimes(1);
    act(() => {
      window.history.pushState(null, '', '/projects');
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.history.pushState(null, '', '/login-callback?code=second&state=second');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(onLoginCallbackStart).toHaveBeenCalledTimes(2);
    // Only release the abandoned operation; the new stage remains pending.
    pending.resolve();
    await act(async () => { await pending.promise; });
    expect(window.location.search).toBe('?code=second&state=second');
    expect(screen.getByRole('status')).toHaveTextContent('Logging in…');
  });
  it('responds to native Back and Forward traversal', async () => {
    const pending = defer();
    const client = makeClient({ hooks: { onLogoutStart: () => pending.promise } });
    render(<ReactAuthProvider client={client}><span>App</span></ReactAuthProvider>);
    act(() => {
      window.history.pushState(null, '', '/projects');
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.history.pushState(null, '', '/logout');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Logging out…');
    window.history.back();
    await waitFor(() => expect(screen.getByText('App')).toBeInTheDocument());
    expect(window.location.pathname).toBe('/projects');
    window.history.forward();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Logging out…'));
    expect(window.location.pathname).toBe('/logout');
  });

  it('notices synthetic and native popstate while ordinary routes leave app children untouched', async () => {
    const pending = defer();
    const client = makeClient({ hooks: { onLogoutStart: () => pending.promise } });
    let childRenders = 0;
    function Host(): ReactElement {
      childRenders += 1;
      return <span>Host application</span>;
    }
    render(<ReactAuthProvider client={client}><Host /></ReactAuthProvider>);
    expect(childRenders).toBe(1);

    act(() => {
      window.history.pushState(null, '', '/projects/42');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(childRenders).toBe(1);

    act(() => {
      window.history.pushState(null, '', '/logout');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByText('Host application')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Logging out…');

    act(() => {
      window.history.replaceState(null, '', '/projects/42');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByText('Host application')).toBeInTheDocument();
    pending.resolve();
    await act(async () => { await pending.promise; });
    expect(window.location.pathname).toBe('/projects/42');
  });

  it('uses push and replace without document navigation and keeps a safe return path', async () => {
    const pending = defer();
    const client = makeClient({ hooks: { onLogoutStart: () => pending.promise } });
    window.history.replaceState(null, '', '/projects/42?tab=activity#notes');
    const pop = vi.fn();
    window.addEventListener('popstate', pop);
    render(<ReactAuthProvider client={client}><span>App</span></ReactAuthProvider>);

    await act(async () => { await client.logout({ returnTo: '/projects/42?tab=activity#notes' }); });
    expect(window.location.pathname).toBe('/logout');
    expect(pop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Logging out…');
    pending.resolve();
    await waitFor(() => expect(window.location.href).toContain('/projects/42?tab=activity#notes'));
    expect(pop).toHaveBeenCalledTimes(2);
    window.removeEventListener('popstate', pop);
  });

  it('observes host adapter navigation without relying on popstate and removes its subscription', async () => {
    const client = makeClient({ hooks: { onLoginStart: () => new Promise<void>(() => undefined) } });
    const listeners = new Set<() => void>();
    let location = '/';
    const navigate = vi.fn(({ to }: { readonly to: string; readonly replace: boolean }) => {
      location = to;
      listeners.forEach((listener) => listener());
    });
    const adapter: AuthNavigationAdapter = {
      navigate,
      getLocation: () => location,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    };
    const mounted = render(
      <AuthClientProvider client={client} navigation={adapter}>
        <AuthBoundary views={{ LoginView: () => <main>Host login screen</main> }}>
          <span>Host app</span>
        </AuthBoundary>
      </AuthClientProvider>,
    );
    expect(listeners.size).toBe(1);
    act(() => {
      location = '/login';
      listeners.forEach((listener) => listener());
    });
    expect(screen.getByText('Host login screen')).toBeInTheDocument();
    expect(screen.queryByText('Host app')).not.toBeInTheDocument();
    mounted.unmount();
    expect(listeners.size).toBe(0);
  });

  it('recognizes configured and explicit callback paths and ignores a late exchange after departure', async () => {
    const pending = defer();
    const client = makeClient({
      paths: { loginCallback: 'callback' },
      redirectUri: `${window.location.origin}/oauth/return`,
      hooks: { onLoginCallbackStart: () => pending.promise },
    });
    client.transactions.save({ clientId: client.config.clientId, state: 'expected', verifier: 'secret', createdAt: Date.now() });
    window.history.replaceState(null, '', '/oauth/return?code=sample&state=expected');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<StrictMode><ReactAuthProvider client={client}><span>App</span></ReactAuthProvider></StrictMode>);
    expect(screen.getByRole('status')).toHaveTextContent('Logging in…');
    act(() => {
      window.history.pushState(null, '', '/projects');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    pending.resolve();
    await act(async () => { await pending.promise; });
    expect(window.location.pathname).toBe('/projects');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('App')).toBeInTheDocument();
  });

  it('recognizes a configured base path and uses a custom default message', () => {
    window.history.replaceState(null, '', '/workspace/projects');
    const client = makeClient({
      appBaseUrl: `${window.location.origin}/workspace/`,
      paths: { login: 'login', loginCallback: 'callback', logout: 'logout' },
      hooks: { onLoginStart: () => new Promise<void>(() => undefined) },
    });
    render(<ReactAuthProvider client={client} messages={{ login: 'Connecting to identity provider…' }}>
      <span>App</span>
    </ReactAuthProvider>);
    act(() => {
      window.history.pushState(null, '', '/workspace/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to identity provider…');
    expect(screen.queryByText('App')).not.toBeInTheDocument();
  });

  it('does not enter login or retain a return path when router navigation rejects', async () => {
    const onLoginStart = vi.fn();
    const client = makeClient({ hooks: { onLoginStart } });
    const adapter: AuthNavigationAdapter = {
      navigate: () => { throw new Error('Route blocked'); },
      getLocation: () => '/',
      subscribe: () => () => undefined,
    };
    render(<ReactAuthProvider client={client} navigation={adapter}><span>App</span></ReactAuthProvider>);
    await expect(client.acquireToken({ returnTo: '/projects' })).rejects.toThrow('Route blocked');
    expect(screen.getByText('App')).toBeInTheDocument();
    expect(onLoginStart).not.toHaveBeenCalled();
    expect(client.transactions.consumeReturnTo()).toBeNull();
  });

  it('clears a later session during a second SPA logout', async () => {
    const onLogout = vi.fn();
    const client = makeClient({ hooks: { onLogout } });
    render(<ReactAuthProvider client={client}><span>App</span></ReactAuthProvider>);
    client.storage.save({ accessToken: 'first', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    await act(async () => { await client.logout(); });
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(client.storage.getRecord()).toBeNull();
    client.storage.save({ accessToken: 'second', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    await act(async () => { await client.logout(); });
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(client.storage.getRecord()).toBeNull();
    expect(onLogout).toHaveBeenCalledTimes(2);
  });

  it('retries a failed login after leaving and reentering its route', async () => {
    const onLoginStart = vi.fn(async () => { throw new Error('Provider unavailable'); });
    const client = makeClient({ hooks: { onLoginStart } });
    render(<StrictMode><ReactAuthProvider client={client}><span>App</span></ReactAuthProvider></StrictMode>);
    const navigate = (to: string): void => {
      window.history.pushState(null, '', to);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };
    act(() => navigate('/login'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable'));
    expect(onLoginStart).toHaveBeenCalledTimes(1);
    act(() => navigate('/'));
    act(() => navigate('/login'));
    await waitFor(() => expect(onLoginStart).toHaveBeenCalledTimes(2));
  });
});
