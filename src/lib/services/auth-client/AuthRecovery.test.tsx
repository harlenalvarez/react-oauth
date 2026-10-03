import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthClientOptions, AuthNavigationAdapter, LoginCallbackViewProps, LogoutViewProps } from '@/types';
import { ReactAuthProvider } from '@/components/auth-provider/ReactAuthProvider';
import { LogoutTransactionStorage } from '../token-storage/LogoutTransactionStorage';
import { AuthClient, createAuthClient } from './AuthClient';

const realWindow = window;
const destination = '/projects/42?tab=activity#notes';
let assign: ReturnType<typeof vi.fn>;
let replace: ReturnType<typeof vi.fn>;
let stops: Array<() => void>;

function makeClient<Profile = unknown>(options: Partial<AuthClientOptions<Profile>> = {}) {
  const onLoginError = vi.fn();
  const onLoginComplete = vi.fn();
  const onLoginCallbackStart = vi.fn();
  const onLogoutError = vi.fn();
  const onLogoutStart = vi.fn();
  const client = createAuthClient<Profile>({
    clientId: `recovery-${crypto.randomUUID()}`,
    authorizationEndpoint: 'https://identity.example.com/authorize',
    tokenEndpoint: 'https://identity.example.com/token',
    hooks: { onLoginError, onLoginComplete, onLoginCallbackStart, onLogoutError, onLogoutStart },
    ...options,
  });
  return { client, onLoginError, onLoginComplete, onLoginCallbackStart, onLogoutError, onLogoutStart };
}

function pendingLogin(client: AuthClient, createdAt = Date.now()) {
  client.transactions.save({ clientId: client.config.clientId, state: 'expected', verifier: 'verifier', createdAt });
  client.transactions.saveReturnTo(destination);
}

function setPath(path: string) {
  realWindow.history.replaceState(null, '', path);
  realWindow.dispatchEvent(new PopStateEvent('popstate'));
}

function tokenResponse() {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'new-session', token_type: 'Bearer', expires_in: 3600 })));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function routing(fail: (to: string) => boolean) {
  const listeners = new Set<() => void>();
  const navigate = vi.fn(async ({ to, replace: replaceEntry }: { to: string; replace: boolean }) => {
    if (fail(to)) throw new Error('Router blocked navigation');
    if (replaceEntry) realWindow.history.replaceState(null, '', to);
    else realWindow.history.pushState(null, '', to);
    listeners.forEach((listener) => listener());
  });
  const adapter: AuthNavigationAdapter = {
    navigate,
    getLocation: () => `${realWindow.location.pathname}${realWindow.location.search}${realWindow.location.hash}`,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { adapter, navigate };
}

function restore() {
  act(() => { realWindow.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  realWindow.history.replaceState(null, '', '/login-callback?code=code&state=expected');
  stops = [];
  assign = vi.fn();
  replace = vi.fn();
  const location = new Proxy({}, {
    get(_target, property) {
      if (property === 'assign') return assign;
      if (property === 'replace') return replace;
      return Reflect.get(realWindow.location, property, realWindow.location);
    },
  });
  vi.stubGlobal('window', new Proxy(realWindow, {
    get(target, property) {
      const value: unknown = property === 'location' ? location : Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }));
});

afterEach(() => {
  cleanup();
  stops.forEach((stop) => stop());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  realWindow.history.replaceState(null, '', '/');
});

describe('callback validation and cancellation', () => {
  it('returns cancellation for a verified denial and keeps it after cleanup and reload', async () => {
    const { client, onLoginError } = makeClient();
    pendingLogin(client);
    setPath('/login-callback?error=access_denied&state=expected&error_description=Spoofed');
    const fetch = tokenResponse();
    await expect(client.completeLogin()).resolves.toEqual({ status: 'cancelled' });
    expect(client.transactions.read()).toBeNull();
    expect(client.transactions.readReturnTo()).toBe(destination);
    expect(fetch).not.toHaveBeenCalled();
    expect(onLoginError).not.toHaveBeenCalled();
    await client.continueAuthStage(null);
    const reloaded = new AuthClient(client.config);
    await expect(reloaded.completeLogin()).resolves.toEqual({ status: 'cancelled' });
    expect(realWindow.location.search).toBe('');
  });

  it.each([
    ['error=access_denied', 'MISSING_STATE'],
    ['error=access_denied&state=wrong&error_description=Spoofed', 'STATE_MISMATCH'],
    ['code=code&state=wrong', 'STATE_MISMATCH'],
    ['code=code&state=expected&state=expected', 'INVALID_CALLBACK_RESPONSE'],
    ['code=one&code=two&state=expected', 'INVALID_CALLBACK_RESPONSE'],
    ['error=access_denied&error=server_error&state=expected', 'INVALID_CALLBACK_RESPONSE'],
    ['error=access_denied&code=code&state=expected', 'INVALID_CALLBACK_RESPONSE'],
    ['error=server_error&state=expected&error_description=one&error_description=two', 'INVALID_CALLBACK_RESPONSE'],
  ])('preserves the genuine transaction and session for invalid response %s', async (query, expectedCode) => {
    const { client } = makeClient();
    pendingLogin(client);
    client.storage.save({ accessToken: 'existing-session', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    const transaction = client.transactions.read();
    setPath(`/login-callback?${query}`);
    const fetch = tokenResponse();
    await expect(client.completeLogin()).rejects.toMatchObject({ code: expectedCode });
    expect(client.transactions.read()).toEqual(transaction);
    expect(client.transactions.readReturnTo()).toBe(destination);
    expect(client.storage.getRecord()?.accessToken).toBe('existing-session');
    expect(fetch).not.toHaveBeenCalled();
    setPath('/login-callback?code=real-code&state=expected');
    await expect(client.completeLogin()).resolves.toEqual({ status: 'complete', returnTo: destination });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['expired', 'different client'] as const)('rejects a denial with an %s transaction without consuming it', async (kind) => {
    const { client } = makeClient();
    pendingLogin(client, kind === 'expired' ? Date.now() - 600001 : Date.now());
    if (kind === 'different client') client.transactions.save({ clientId: 'other-client', state: 'expected', verifier: 'verifier', createdAt: Date.now() });
    const key = `react-oauth:transaction:${encodeURIComponent(client.config.clientId)}`;
    const raw = sessionStorage.getItem(key);
    setPath('/login-callback?error=access_denied&state=expected');
    await expect(client.completeLogin()).rejects.toMatchObject({ code: 'MISSING_TRANSACTION' });
    expect(sessionStorage.getItem(key)).toBe(raw);
    expect(client.transactions.readReturnTo()).toBe(destination);
  });

  it('uses a library-owned message for genuine provider failures', async () => {
    const { client, onLoginError } = makeClient();
    pendingLogin(client);
    setPath('/login-callback?error=server_error&state=expected&error_description=Spoofed');
    await expect(client.completeLogin()).rejects.toMatchObject({ code: 'server_error', message: 'The authorization server could not complete login.' });
    expect(onLoginError).toHaveBeenCalledTimes(1);
    expect(onLoginError.mock.calls[0][0].message).not.toContain('Spoofed');
    expect(client.transactions.read()).toBeNull();
    expect(client.transactions.readReturnTo()).toBe(destination);
  });

  it('does not discard a newer stored session when a completion hook fails', async () => {
    const { client } = makeClient({ hooks: { onLoginComplete: async (): Promise<void> => {
      client.storage.save({ accessToken: 'newer-session', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
      throw new Error('Old completion failed');
    } } });
    pendingLogin(client);
    tokenResponse();
    await expect(client.completeLogin()).rejects.toThrow('Old completion failed');
    expect(client.storage.getRecord()?.accessToken).toBe('newer-session');
    expect(client.getSnapshot().status).toBe('authenticated');
  });

  it('retains callback cancellation after bfcache restoration without repeating hooks', async () => {
    const { client, onLoginCallbackStart, onLoginError } = makeClient();
    pendingLogin(client);
    setPath('/login-callback?error=access_denied&state=expected');
    render(<ReactAuthProvider client={client}>App</ReactAuthProvider>);
    await screen.findByRole('button', { name: 'Log in' });
    await waitFor(() => expect(realWindow.location.search).toBe(''));
    restore();
    await screen.findByRole('button', { name: 'Log in' });
    expect(screen.getByText('Login was cancelled. You can try again.')).toBeInTheDocument();
    expect(onLoginCallbackStart).toHaveBeenCalledTimes(1);
    expect(onLoginError).not.toHaveBeenCalled();
    expect(client.transactions.readReturnTo()).toBe(destination);
  });

  it('uses the saved destination for an existing-session callback and consumes it only after navigation', async () => {
    const { client } = makeClient();
    client.storage.save({ accessToken: 'existing', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    client.transactions.saveReturnTo(destination);
    await expect(client.completeLogin()).resolves.toEqual({ status: 'complete', returnTo: destination });
    expect(client.transactions.readReturnTo()).toBe(destination);
    await client.continueAuthStage(destination);
    expect(`${realWindow.location.pathname}${realWindow.location.search}${realWindow.location.hash}`).toBe(destination);
    expect(client.transactions.readReturnTo()).toBeNull();
  });

  it('offers callback retry, coalesces clicks, and supports a second provider denial', async () => {
    const { client, onLoginError } = makeClient();
    pendingLogin(client);
    setPath('/login-callback?error=access_denied&state=expected');
    render(<StrictMode><ReactAuthProvider client={client}>App</ReactAuthProvider></StrictMode>);
    const button = await screen.findByRole('button', { name: 'Log in' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(realWindow.location.pathname).toBe('/login');
    expect(client.transactions.readReturnTo()).toBe(destination);
    const state = client.transactions.read()?.state;
    expect(state).not.toBe('expected');
    act(() => setPath(`/login-callback?error=access_denied&state=${state}`));
    expect(await screen.findByText('Login was cancelled. You can try again.')).toBeInTheDocument();
    expect(onLoginError).not.toHaveBeenCalled();
  });
});

describe('navigation recovery after flow completion', () => {
  it.each(['cleanup', 'return'] as const)('keeps login complete when %s navigation fails, including after reload', async (phase) => {
    const { client, onLoginComplete, onLoginCallbackStart, onLoginError } = makeClient();
    pendingLogin(client);
    const fetch = tokenResponse();
    let blocked = true;
    const { adapter } = routing((to) => blocked && to === (phase === 'cleanup' ? '/login-callback' : destination));
    function View(props: LoginCallbackViewProps) {
      return <main><p>{props.status}</p><p>{props.error?.code ?? 'no flow error'}</p>
        {props.navigationError !== null && <button type="button" onClick={props.onContinue}>Continue</button>}
      </main>;
    }
    const first = render(<ReactAuthProvider client={client} navigation={adapter} views={{ LoginCallbackView: View }}>App</ReactAuthProvider>);
    await screen.findByRole('button', { name: 'Continue' });
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(screen.getByText('no flow error')).toBeInTheDocument();
    expect(client.getSnapshot().status).toBe('authenticated');
    expect(client.transactions.readReturnTo()).toBe(destination);
    expect(onLoginError).not.toHaveBeenCalled();
    restore();
    await screen.findByRole('button', { name: 'Continue' });
    first.unmount();
    // If cleanup failed, a reload keeps the old callback URL; the valid session prevents another exchange.
    const reloaded = new AuthClient(client.config);
    render(<ReactAuthProvider client={reloaded} navigation={adapter} views={{ LoginCallbackView: View }}>App</ReactAuthProvider>);
    const button = await screen.findByRole('button', { name: 'Continue' });
    blocked = false;
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => expect(realWindow.location.pathname).toBe('/projects/42'));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onLoginComplete).toHaveBeenCalledTimes(1);
    expect(onLoginCallbackStart).toHaveBeenCalledTimes(1);
    expect(reloaded.transactions.readReturnTo()).toBeNull();
  });

  it('retains local logout completion and destination across a rejected navigation and reload', async () => {
    setPath('/logout');
    const { client, onLogoutStart, onLogoutError } = makeClient();
    client.storage.save({ accessToken: 'access', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    client.transactions.saveReturnTo(destination);
    let blocked = true;
    const { adapter } = routing((to) => blocked && to === destination);
    function View(props: LogoutViewProps) {
      return <main><p>{props.status}</p><p>{props.error?.code ?? 'no flow error'}</p>
        {props.navigationError !== null && <button type="button" onClick={props.onContinue}>Continue</button>}
      </main>;
    }
    const first = render(<ReactAuthProvider client={client} navigation={adapter} views={{ LogoutView: View }}>App</ReactAuthProvider>);
    await screen.findByRole('button', { name: 'Continue' });
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(client.storage.getRecord()).toBeNull();
    expect(onLogoutError).not.toHaveBeenCalled();
    restore();
    await screen.findByRole('button', { name: 'Continue' });
    first.unmount();
    const reloaded = new AuthClient(client.config);
    render(<ReactAuthProvider client={reloaded} navigation={adapter} views={{ LogoutView: View }}>App</ReactAuthProvider>);
    const button = await screen.findByRole('button', { name: 'Continue' });
    blocked = false;
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => expect(realWindow.location.pathname).toBe('/projects/42'));
    expect(onLogoutStart).toHaveBeenCalledTimes(1);
  });

  it('retries logout callback cleanup without repeating logout or reporting a protocol failure', async () => {
    setPath('/logout');
    const { client, onLogoutStart, onLogoutError } = makeClient({ endSessionEndpoint: 'https://identity.example.com/logout' });
    await client.completeLogout();
    const state = new URL(replace.mock.calls[0][0]).searchParams.get('state');
    setPath(`/logout?state=${state}`);
    let blocked = true;
    const { adapter } = routing(() => blocked);
    render(<ReactAuthProvider client={client} navigation={adapter}>App</ReactAuthProvider>);
    await screen.findByRole('button', { name: 'Continue' });
    expect(screen.getByText('Logged out.')).toBeInTheDocument();
    expect(onLogoutError).not.toHaveBeenCalled();
    blocked = false;
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(realWindow.location.search).toBe(''));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(onLogoutStart).toHaveBeenCalledTimes(1);
  });
});

describe('logout cancellation and retry', () => {
  it('preserves a newer session and a cancelled marker across reload until explicit retry', async () => {
    setPath('/logout');
    const { client, onLogoutError } = makeClient({ endSessionEndpoint: 'https://identity.example.com/logout' });
    await client.completeLogout();
    client.storage.save({ accessToken: 'newer-session', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    const reloaded = new AuthClient(client.config);
    await expect(reloaded.completeLogout()).resolves.toEqual({ status: 'cancelled' });
    await expect(new AuthClient(client.config).completeLogout()).resolves.toEqual({ status: 'cancelled' });
    expect(client.storage.getRecord()?.accessToken).toBe('newer-session');
    expect(onLogoutError).not.toHaveBeenCalled();
    render(<ReactAuthProvider client={reloaded}>App</ReactAuthProvider>);
    restore();
    const button = await screen.findByRole('button', { name: 'Log out' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    expect(reloaded.storage.getRecord()).toBeNull();
    expect(new LogoutTransactionStorage(client.config.clientId).get()?.status).toBe('pending');
  });

  it('offers explicit retry for an expired pending provider logout', async () => {
    setPath('/logout');
    const { client } = makeClient({ endSessionEndpoint: 'https://identity.example.com/logout' });
    new LogoutTransactionStorage(client.config.clientId).save({ status: 'pending', callbackUri: client.config.postLogoutRedirectUri!, state: 'old-state', createdAt: Date.now() - 600001 });
    render(<ReactAuthProvider client={client}>App</ReactAuthProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(new URL(replace.mock.calls[0][0]).searchParams.get('state')).not.toBe('old-state');
  });

  it('retries a cancelled custom provider callback through the canonical logout route', async () => {
    setPath('/workspace/session-ended');
    const { client } = makeClient({ appBaseUrl: `${realWindow.location.origin}/workspace/`, endSessionEndpoint: 'https://identity.example.com/logout', postLogoutRedirectUri: 'session-ended' });
    new LogoutTransactionStorage(client.config.clientId).save({ status: 'pending', callbackUri: client.config.postLogoutRedirectUri!, state: 'old-state', createdAt: Date.now() });
    render(<ReactAuthProvider client={client}>App</ReactAuthProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(realWindow.location.pathname).toBe('/workspace/logout');
    expect(new URL(replace.mock.calls[0][0]).searchParams.get('post_logout_redirect_uri')).toBe(client.config.postLogoutRedirectUri);
  });

  it('restores the cancelled marker when retry navigation rejects and Continue retries the explicit action', async () => {
    setPath('/logout');
    const { client, onLogoutStart } = makeClient({ endSessionEndpoint: 'https://identity.example.com/logout' });
    const storage = new LogoutTransactionStorage(client.config.clientId);
    storage.save({ status: 'cancelled', callbackUri: client.config.postLogoutRedirectUri! });
    client.storage.save({ accessToken: 'newer-session', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    let blocked = true;
    const { adapter } = routing(() => blocked);
    render(<ReactAuthProvider client={client} navigation={adapter}>App</ReactAuthProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await screen.findByRole('button', { name: 'Continue' });
    expect(storage.get()?.status).toBe('cancelled');
    expect(client.storage.getRecord()?.accessToken).toBe('newer-session');
    expect(onLogoutStart).not.toHaveBeenCalled();
    blocked = false;
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });
});

describe('client browser restoration', () => {
  it.each(['removed', 'expired', 'replaced'] as const)('reconciles a protected page when stored credentials are %s', async (kind) => {
    setPath('/projects');
    const loadProfile = vi.fn(async ({ accessToken }: { accessToken: string }) => ({ account: accessToken }));
    const { client } = makeClient({ loadProfile });
    client.storage.save({ accessToken: 'old', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    stops.push(client.observeNavigation(undefined));
    await client.initialize();
    expect(client.getSnapshot().profile).toEqual({ account: 'old' });
    if (kind === 'removed') client.storage.clear();
    else client.storage.save({ accessToken: kind === 'replaced' ? 'new' : 'old', tokenType: 'Bearer', expiresAt: kind === 'expired' ? 0 : Date.now() + 600000 });
    restore();
    await waitFor(() => expect(client.getSnapshot().status).toBe(kind === 'replaced' ? 'authenticated' : 'anonymous'));
    await waitFor(() => expect(client.getSnapshot().profile).toEqual(kind === 'replaced' ? { account: 'new' } : null));
    expect(client.getSnapshot().idTokenClaims).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not let a frozen profile request restore old identity after logout', async () => {
    setPath('/projects');
    let resolveProfile: (value: { account: string }) => void = () => undefined;
    const loadProfile = vi.fn(() => new Promise<{ account: string }>((resolve) => { resolveProfile = resolve; }));
    const { client } = makeClient({ loadProfile });
    client.storage.save({ accessToken: 'old', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    stops.push(client.observeNavigation(undefined));
    const initial = client.initialize();
    await waitFor(() => expect(loadProfile).toHaveBeenCalledTimes(1));
    client.storage.clear();
    restore();
    resolveProfile({ account: 'old' });
    await initial;
    expect(client.getSnapshot()).toMatchObject({ status: 'anonymous', profile: null, profileStatus: 'idle' });
  });

  it('does not block restored cancellation behind an optional pending profile loader', async () => {
    setPath('/login-callback?error=access_denied&state=expected');
    const loadProfile = vi.fn(() => new Promise<void>(() => undefined));
    const { client } = makeClient({ loadProfile });
    pendingLogin(client);
    client.storage.save({ accessToken: 'existing', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    render(<ReactAuthProvider client={client}>App</ReactAuthProvider>);
    await screen.findByRole('button', { name: 'Log in' });
    await waitFor(() => expect(realWindow.location.search).toBe(''));
    restore();
    await screen.findByRole('button', { name: 'Log in' });
    expect(client.getSnapshot()).toMatchObject({ status: 'authenticated', profileStatus: 'loading' });
  });

  it('invalidates a frozen refresh request before it can restore cleared credentials', async () => {
    setPath('/projects');
    const { client } = makeClient();
    client.storage.save({ accessToken: 'expired', tokenType: 'Bearer', expiresAt: 0, refreshToken: 'refresh' });
    let resolveFetch: (response: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    stops.push(client.observeNavigation(undefined));
    const refresh = client.silentRenewToken();
    client.storage.clear();
    restore();
    resolveFetch(new Response(JSON.stringify({ access_token: 'old-renewed', token_type: 'Bearer', expires_in: 3600 })));
    await expect(refresh).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(client.storage.getRecord()).toBeNull();
    expect(client.getSnapshot().status).toBe('anonymous');
  });

  it('shares one restoration listener across providers and removes it on final cleanup', async () => {
    setPath('/projects');
    const { client } = makeClient();
    const add = vi.spyOn(realWindow, 'addEventListener');
    const remove = vi.spyOn(realWindow, 'removeEventListener');
    const first = render(<ReactAuthProvider client={client}>First</ReactAuthProvider>);
    const second = render(<ReactAuthProvider client={client}>Second</ReactAuthProvider>);
    expect(add.mock.calls.filter(([type]) => type === 'pageshow')).toHaveLength(1);
    first.unmount();
    expect(remove.mock.calls.filter(([type]) => type === 'pageshow')).toHaveLength(0);
    second.unmount();
    expect(remove.mock.calls.filter(([type]) => type === 'pageshow')).toHaveLength(1);
  });
});
