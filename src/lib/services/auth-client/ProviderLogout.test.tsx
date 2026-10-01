import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthClient, createAuthClient } from './AuthClient';
import { normalizeAuthConfig } from './normalizeAuthConfig';
import { ReactAuthProvider } from '@/components/auth-provider/ReactAuthProvider';
import { LogoutTransactionStorage } from '../token-storage/LogoutTransactionStorage';
import type { AuthClientOptions, LogoutViewProps } from '@/types';

const realWindow = window;
let replace: ReturnType<typeof vi.fn>;

function makeClient(options: Partial<AuthClientOptions> = {}) {
  return createAuthClient({
    clientId: `logout-${crypto.randomUUID()}`,
    authorizationEndpoint: 'https://identity.example.com/authorize',
    tokenEndpoint: 'https://identity.example.com/token',
    endSessionEndpoint: 'https://identity.example.com/logout?provider=value&state=stale&id_token_hint=stale',
    ...options,
  });
}

function setLocation(path: string) {
  realWindow.history.replaceState(null, '', path);
  realWindow.dispatchEvent(new PopStateEvent('popstate'));
}

function pending(client: AuthClient, overrides: { state?: string; createdAt?: number; callbackUri?: string } = {}) {
  new LogoutTransactionStorage(client.config.clientId).save({
    status: 'pending', callbackUri: client.config.postLogoutRedirectUri!, state: 'expected', createdAt: Date.now(), ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  realWindow.history.replaceState(null, '', '/logout');
  replace = vi.fn();
  const location = new Proxy({}, {
    get(_target, property) { return property === 'replace' ? replace : Reflect.get(realWindow.location, property, realWindow.location); },
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  realWindow.history.replaceState(null, '', '/');
});

describe('provider logout', () => {
  it('captures the hint, clears credentials, and builds one encoded browser redirect', async () => {
    const client = makeClient({ clientId: `special +&-${crypto.randomUUID()}` });
    client.storage.save({ accessToken: 'access', tokenType: 'Bearer', expiresAt: 0, refreshToken: 'refresh', idToken: 'expired.jwt+&hint' });
    client.transactions.save({ clientId: client.config.clientId, state: 'login-state', verifier: 'secret', createdAt: Date.now() });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(Promise.all([client.completeLogout(), client.completeLogout()])).resolves.toEqual([
      { status: 'redirecting' }, { status: 'redirecting' },
    ]);
    expect(replace).toHaveBeenCalledTimes(1);
    const url = new URL(replace.mock.calls[0][0]);
    expect(url.searchParams.get('client_id')).toBe(client.config.clientId);
    expect(url.searchParams.get('id_token_hint')).toBe('expired.jwt+&hint');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(`${realWindow.location.origin}/logout`);
    expect(url.searchParams.get('provider')).toBe('value');
    expect(url.searchParams.getAll('state')).toHaveLength(1);
    expect(url.searchParams.get('state')).toMatch(/^[\w-]{32}$/);
    expect(client.storage.getRecord()).toBeNull();
    expect(client.transactions.consume()).toBeNull();
    expect(client.getSnapshot()).toMatchObject({ status: 'anonymous', profile: null, idTokenClaims: null, grantedScopes: null });
    expect(sessionStorage.getItem(`react-oauth:logout:${encodeURIComponent(client.config.clientId)}`)).not.toMatch(/hint|access|refresh|secret/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not restore or discard an expired ID-token hint during initialization', async () => {
    const client = makeClient({ oidc: { issuer: 'https://identity.example.com', jwksUri: 'https://identity.example.com/keys' } });
    client.storage.save({ accessToken: 'access', tokenType: 'Bearer', expiresAt: Date.now() + 600_000, idToken: 'expired-token' });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await client.initialize();
    await client.completeLogout();
    expect(new URL(replace.mock.calls[0][0]).searchParams.get('id_token_hint')).toBe('expired-token');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('identifies the client without a hint and removes a stale configured hint', async () => {
    const client = makeClient();
    await client.completeLogout();
    const url = new URL(replace.mock.calls[0][0]);
    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(url.searchParams.get('client_id')).toBe(client.config.clientId);
  });

  it('validates a callback, cleans its URL, and keeps completion across remounts', async () => {
    const onLogout = vi.fn();
    const client = makeClient({ hooks: { onLogout } });
    pending(client);
    setLocation('/logout?state=expected');
    await expect(client.completeLogout()).resolves.toEqual({ status: 'complete', returnTo: null });
    expect(realWindow.location.search).toBe('');
    const reloaded = new AuthClient(client.config);
    await expect(reloaded.completeLogout()).resolves.toEqual({ status: 'complete', returnTo: null });
    expect(onLogout).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    setLocation('/logout?state=expected');
    await expect(reloaded.completeLogout()).rejects.toMatchObject({ code: 'MISSING_LOGOUT_TRANSACTION' });
  });

  it.each([
    ['mismatched', '/logout?state=wrong', {}, 'LOGOUT_STATE_MISMATCH'],
    ['duplicate', '/logout?state=expected&state=expected', {}, 'LOGOUT_STATE_MISMATCH'],
    ['missing', '/logout', {}, 'INCOMPLETE_PROVIDER_LOGOUT'],
    ['expired', '/logout?state=expected', { createdAt: Date.now() - 600_001 }, 'EXPIRED_LOGOUT_TRANSACTION'],
    ['wrong location', '/elsewhere?state=expected', {}, 'INVALID_LOGOUT_CALLBACK'],
    ['provider failure', '/logout?state=expected&error=denied', {}, 'PROVIDER_LOGOUT_FAILED'],
  ])('rejects %s returns without clearing a newer session or redirecting', async (_name, path, overrides, code) => {
    const client = makeClient();
    pending(client, overrides);
    client.storage.save({ accessToken: 'newer', tokenType: 'Bearer', expiresAt: Date.now() + 600_000 });
    setLocation(path);
    await expect(client.completeLogout()).rejects.toMatchObject({ code });
    expect(client.storage.getRecord()?.accessToken).toBe('newer');
    expect(replace).not.toHaveBeenCalled();
    const reloaded = new AuthClient(client.config);
    setLocation('/logout');
    await expect(reloaded.completeLogout()).rejects.toMatchObject({ code });
    expect(replace).not.toHaveBeenCalled();
  });

  it('rejects an unsolicited return rather than starting logout', async () => {
    const client = makeClient();
    setLocation('/logout?state=unsolicited');
    await expect(client.completeLogout()).rejects.toMatchObject({ code: 'MISSING_LOGOUT_TRANSACTION' });
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not clear a newer session on a valid older callback', async () => {
    const client = makeClient();
    pending(client);
    client.storage.save({ accessToken: 'newer', tokenType: 'Bearer', expiresAt: Date.now() + 600_000 });
    setLocation('/logout?state=expected');
    await client.completeLogout();
    expect(client.storage.getRecord()?.accessToken).toBe('newer');
  });

  it('keeps local logout and attempts provider logout when observer hooks reject', async () => {
    const onLogoutError = vi.fn();
    const onLogout = vi.fn(async () => { throw new Error('after failed'); });
    const client = makeClient({ hooks: { onLogoutStart: async () => { throw new Error('before failed'); }, onLogout, onLogoutError } });
    client.storage.save({ accessToken: 'access', tokenType: 'Bearer', expiresAt: 0 });
    await expect(client.completeLogout()).resolves.toEqual({ status: 'redirecting' });
    expect(client.storage.getRecord()).toBeNull();
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(onLogoutError).toHaveBeenCalledWith({ code: 'LOGOUT_START_FAILED', message: 'before failed', stage: 'logout' });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('reports redirect failures and does not retry on a reload', async () => {
    replace.mockImplementation(() => { throw new Error('navigation failed'); });
    const client = makeClient();
    client.storage.save({ accessToken: 'access', tokenType: 'Bearer', expiresAt: 0 });
    await expect(client.completeLogout()).rejects.toThrow('navigation failed');
    expect(client.storage.getRecord()).toBeNull();
    await expect(new AuthClient(client.config).completeLogout()).rejects.toThrow('navigation failed');
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('supports custom callbacks under a base path', async () => {
    setLocation('/workspace/logout');
    const client = makeClient({ appBaseUrl: `${realWindow.location.origin}/workspace/`, postLogoutRedirectUri: 'session-ended' });
    pending(client);
    setLocation('/workspace/session-ended?state=expected');
    expect(client.getAuthRouteSnapshot().stage).toBe('logout');
    render(<ReactAuthProvider client={client}>App</ReactAuthProvider>);
    expect(await screen.findByText('Logged out.')).toBeInTheDocument();
    expect(realWindow.location.pathname).toBe('/workspace/session-ended');
    expect(replace).not.toHaveBeenCalled();
  });

  it('observes callback queries within the same stage and coalesces Strict Mode', async () => {
    const client = makeClient();
    render(<StrictMode><ReactAuthProvider client={client}>App</ReactAuthProvider></StrictMode>);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const state = new URL(replace.mock.calls[0][0]).searchParams.get('state');
    act(() => setLocation(`/logout?state=${state}`));
    expect(await screen.findByText('Logged out.')).toBeInTheDocument();
    expect(realWindow.location.search).toBe('');
    expect(replace).toHaveBeenCalledTimes(1);
    act(() => setLocation('/projects'));
    act(() => setLocation('/logout'));
    expect(await screen.findByText('Logged out.')).toBeInTheDocument();
    await act(async () => { await client.logout(); });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
  });

  it('keeps protocol processing inside the library with a replaceable completion view', async () => {
    const client = makeClient();
    pending(client);
    setLocation('/logout?state=expected');
    function View({ status, error }: LogoutViewProps) {
      return <main>{error?.code ?? `Custom logout: ${status}`}</main>;
    }
    render(<ReactAuthProvider client={client} views={{ LogoutView: View }}>App</ReactAuthProvider>);
    expect(await screen.findByText('Custom logout: complete')).toBeInTheDocument();
    expect(realWindow.location.search).toBe('');
    expect(replace).not.toHaveBeenCalled();
  });

  it('abandons callback cleanup if the user leaves before it runs', async () => {
    const client = makeClient();
    pending(client);
    setLocation('/logout?state=expected');
    const stop = client.observeNavigation(undefined);
    const result = client.completeLogout();
    setLocation('/projects');
    client.storage.save({ accessToken: 'newer', tokenType: 'Bearer', expiresAt: Date.now() + 600_000 });
    await expect(result).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(realWindow.location.pathname).toBe('/projects');
    expect(new LogoutTransactionStorage(client.config.clientId).get()?.status).toBe('pending');
    expect(client.storage.getRecord()?.accessToken).toBe('newer');
    stop();
  });

  it('clears completion markers when starting another login', async () => {
    const client = makeClient({ hooks: { onLoginStart: async () => { throw new Error('stop login'); } } });
    new LogoutTransactionStorage(client.config.clientId).save({ status: 'complete', callbackUri: client.config.postLogoutRedirectUri! });
    await expect(client.startLogin()).rejects.toThrow('stop login');
    expect(new LogoutTransactionStorage(client.config.clientId).get()).toBeNull();
  });

  it('does not clear or redirect when a pending logout is abandoned for a newer session', async () => {
    let resolve: () => void = () => undefined;
    const pause = new Promise<void>((done) => { resolve = done; });
    const client = makeClient({ hooks: { onLogoutStart: () => pause } });
    render(<ReactAuthProvider client={client}>App</ReactAuthProvider>);
    act(() => setLocation('/projects'));
    client.storage.save({ accessToken: 'newer', tokenType: 'Bearer', expiresAt: Date.now() + 600_000 });
    await act(async () => { resolve(); await pause; });
    expect(client.storage.getRecord()?.accessToken).toBe('newer');
    expect(replace).not.toHaveBeenCalled();
    expect(realWindow.location.pathname).toBe('/projects');
  });

  it('keeps local cleanup when saving the provider transaction fails', async () => {
    const client = makeClient();
    client.storage.save({ accessToken: 'access', tokenType: 'Bearer', expiresAt: 0 });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    await expect(client.completeLogout()).rejects.toThrow('storage unavailable');
    expect(client.storage.getRecord()).toBeNull();
    expect(client.getSnapshot().status).toBe('anonymous');
    expect(replace).not.toHaveBeenCalled();
  });

  it('rejects corrupt transaction storage without touching a newer session', async () => {
    const client = makeClient();
    client.storage.save({ accessToken: 'newer', tokenType: 'Bearer', expiresAt: Date.now() + 600_000 });
    sessionStorage.setItem(`react-oauth:logout:${encodeURIComponent(client.config.clientId)}`, '{broken');
    await expect(client.completeLogout()).rejects.toMatchObject({ code: 'LOGOUT_CALLBACK_FAILED' });
    expect(client.storage.getRecord()?.accessToken).toBe('newer');
    expect(replace).not.toHaveBeenCalled();
  });

  it('resets completion when entering login even if another usable session already exists', async () => {
    const client = makeClient();
    new LogoutTransactionStorage(client.config.clientId).save({ status: 'complete', callbackUri: client.config.postLogoutRedirectUri! });
    client.storage.save({ accessToken: 'newer', tokenType: 'Bearer', expiresAt: Date.now() + 600_000 });
    await client.enterLoginStage();
    expect(new LogoutTransactionStorage(client.config.clientId).get()).toBeNull();
  });

  it('includes logout options in client identity', () => {
    const client = makeClient();
    expect(createAuthClient(client.config)).toBe(client);
    expect(() => createAuthClient({ ...client.config, endSessionEndpoint: 'https://other.example.com/logout' })).toThrow('Conflicting');
    expect(() => createAuthClient({ ...client.config, postLogoutRedirectUri: '/finished' })).toThrow('Conflicting');
  });
});

describe('logout configuration', () => {
  const options = { clientId: 'config-test', authorizationEndpoint: 'https://identity.example.com/authorize', tokenEndpoint: 'https://identity.example.com/token' };
  it('defaults to the configured logout route', () => {
    expect(normalizeAuthConfig({ ...options, endSessionEndpoint: 'https://identity.example.com/logout', appBaseUrl: `${realWindow.location.origin}/workspace/`, paths: { logout: 'exit' } }).postLogoutRedirectUri)
      .toBe(`${realWindow.location.origin}/workspace/exit`);
  });
  it.each([
    { postLogoutRedirectUri: '/logout' },
    { endSessionEndpoint: 'https://identity.example.com/logout#fragment' },
    { endSessionEndpoint: 'https://identity.example.com/logout#' },
    { postLogoutRedirectUri: '/logout?', endSessionEndpoint: 'https://identity.example.com/logout' },
    { endSessionEndpoint: 'https://user:secret@identity.example.com/logout' },
    { endSessionEndpoint: 'http://identity.example.com/logout' },
    { postLogoutRedirectUri: '/logout?query=1', endSessionEndpoint: 'https://identity.example.com/logout' },
    { postLogoutRedirectUri: '/logout#fragment', endSessionEndpoint: 'https://identity.example.com/logout' },
    { postLogoutRedirectUri: 'https://other.example.com/logout', endSessionEndpoint: 'https://identity.example.com/logout' },
    { postLogoutRedirectUri: '/login', endSessionEndpoint: 'https://identity.example.com/logout' },
    { postLogoutRedirectUri: '/login-callback', endSessionEndpoint: 'https://identity.example.com/logout' },
    { postLogoutRedirectUri: '/', endSessionEndpoint: 'https://identity.example.com/logout' },
  ])('rejects invalid logout configuration %j', (extra) => {
    expect(() => normalizeAuthConfig({ ...options, ...extra })).toThrow();
  });
});
