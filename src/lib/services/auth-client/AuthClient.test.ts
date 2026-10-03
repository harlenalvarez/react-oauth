import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAuthorizationUrl, createAuthClient } from './AuthClient';
import { normalizeAuthConfig } from './normalizeAuthConfig';

describe('AuthClient login start', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('builds a complete S256 authorization-code request', async () => {
    const config = normalizeAuthConfig({
      clientId: 'browser-app',
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      redirectUri: 'https://app.example.test/login-callback',
      scopes: ['projects.read', 'profile'],
    });
    const url = await buildAuthorizationUrl(
      config,
      'random-state',
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    );

    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('browser-app');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.test/login-callback');
    expect(url.searchParams.get('scope')).toBe('projects.read profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(url.searchParams.get('state')).toBe('random-state');
  });

  it('adds openid scope and a transaction nonce only in OIDC mode', async () => {
    const config = normalizeAuthConfig({
      clientId: 'oidc-browser-app',
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      oidc: { issuer: 'https://identity.example.com', jwksUri: 'https://identity.example.com/jwks' },
    });
    const url = await buildAuthorizationUrl(config, 'state', 'verifier', 'nonce-value');
    expect(config.scopes).toEqual(['openid']);
    expect(url.searchParams.get('scope')).toBe('openid');
    expect(url.searchParams.get('nonce')).toBe('nonce-value');
  });

  it('reuses a client for identical config and rejects conflicting endpoints', () => {
    const config = {
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    };
    expect(createAuthClient(config)).toBe(createAuthClient({ ...config }));
    expect(() => createAuthClient({ ...config, tokenEndpoint: 'https://other.example.com/token' }))
      .toThrow(/Conflicting auth configuration/);
  });

  it('cleans up one failed PKCE login start despite duplicate stage mounts', async () => {
    const onLoginStart = vi.fn(async () => { throw new Error('pause failed'); });
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      hooks: { onLoginStart },
    });

    const results = await Promise.allSettled([client.startLogin(), client.startLogin()]);
    const transaction = sessionStorage.getItem(`react-oauth:transaction:${encodeURIComponent(client.config.clientId)}`);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(onLoginStart).toHaveBeenCalledTimes(1);
    expect(transaction).toBeNull();
  });

  it('validates state and exchanges the code as URL-encoded form data before committing tokens', async () => {
    const onLoginCallbackStart = vi.fn(async () => undefined);
    const afterTokenExchange = vi.fn(async () => undefined);
    const onLoginComplete = vi.fn(async () => undefined);
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      scopes: ['projects.read'],
      hooks: { onLoginCallbackStart, afterTokenExchange, onLoginComplete },
    });
    client.transactions.save({ clientId: client.config.clientId, state: 'saved-state', verifier: 'saved-verifier', createdAt: Date.now() });
    client.transactions.saveReturnTo('/projects/42?tab=activity');
    window.history.replaceState(null, '', '/login-callback?code=code-value&state=saved-state');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        access_token: 'opaque-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-value',
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const returnTo = await client.completeLogin();

    expect(returnTo).toEqual({ status: 'complete', returnTo: '/projects/42?tab=activity' });
    expect(onLoginCallbackStart).toHaveBeenCalledOnce();
    expect(afterTokenExchange).toHaveBeenCalledWith({ accessToken: 'opaque-access-token' });
    expect(onLoginComplete).toHaveBeenCalledWith({ accessToken: 'opaque-access-token' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(requestInit?.body).toBeInstanceOf(URLSearchParams);
    const body = requestInit?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe(client.config.clientId);
    expect(body.get('code')).toBe('code-value');
    expect(body.get('code_verifier')).toBe('saved-verifier');
    expect(body.get('redirect_uri')).toBe(client.config.redirectUri);
    expect(client.storage.getRecord()).toMatchObject({ accessToken: 'opaque-access-token', refreshToken: 'refresh-value' });
  });

  it('rejects a state mismatch without contacting the token endpoint', async () => {
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    client.transactions.save({ clientId: client.config.clientId, state: 'expected', verifier: 'verifier', createdAt: Date.now() });
    window.history.replaceState(null, '', '/login-callback?code=code&state=attacker');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.completeLogin()).rejects.toMatchObject({ code: 'STATE_MISMATCH' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.storage.getRecord()).toBeNull();
    expect(client.transactions.read()?.state).toBe('expected');
  });

  it('treats a replayed callback as complete when an existing valid session is present', async () => {
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    client.storage.save({ accessToken: 'existing-session', tokenType: 'Bearer', expiresAt: Date.now() + 300_000 });
    window.history.replaceState(null, '', '/login-callback?code=used-code&state=used-state');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.completeLogin()).resolves.toEqual({ status: 'complete', returnTo: '/' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.storage.getRecord()?.accessToken).toBe('existing-session');
    expect(client.getSnapshot().status).toBe('authenticated');
  });

  it('rejects malformed and HTTP-error token responses without storing a session', async () => {
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    client.transactions.save({ clientId: client.config.clientId, state: 'state', verifier: 'verifier', createdAt: Date.now() });
    window.history.replaceState(null, '', '/login-callback?code=code&state=state');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => null } as Response)));
    await expect(client.completeLogin()).rejects.toMatchObject({ code: 'INVALID_TOKEN_RESPONSE' });
    expect(client.storage.getRecord()).toBeNull();

    const failingClient = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    failingClient.transactions.save({ clientId: failingClient.config.clientId, state: 'other-state', verifier: 'verifier', createdAt: Date.now() });
    window.history.replaceState(null, '', '/login-callback?code=code&state=other-state');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'invalid_grant' }) } as Response)));
    await expect(failingClient.completeLogin()).rejects.toMatchObject({ code: 'invalid_grant' });
    expect(failingClient.storage.getRecord()).toBeNull();
  });

  it('rejects a malformed OIDC ID token before committing OAuth tokens', async () => {
    const client = createAuthClient({
      clientId: `oidc-client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      oidc: { issuer: 'https://identity.example.com', jwksUri: 'https://identity.example.com/jwks' },
    });
    client.transactions.save({
      clientId: client.config.clientId,
      state: 'state', verifier: 'verifier', createdAt: Date.now(), nonce: 'nonce',
    });
    window.history.replaceState(null, '', '/login-callback?code=code&state=state');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'token', token_type: 'Bearer', expires_in: 60, id_token: 'not-a-jwt' }),
    } as Response)));

    await expect(client.completeLogin()).rejects.toThrow('compact signed JWT');
    expect(client.storage.getRecord()).toBeNull();
    expect(client.getIdTokenClaims()).toBeNull();
  });

  it('does not keep tokens when the awaited post-exchange hook fails', async () => {
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      hooks: { afterTokenExchange: async () => { throw new Error('permission setup failed'); } },
    });
    client.transactions.save({ clientId: client.config.clientId, state: 'state', verifier: 'verifier', createdAt: Date.now() });
    window.history.replaceState(null, '', '/login-callback?code=code&state=state');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'token', token_type: 'Bearer', expires_in: 60 }),
    } as Response)));

    await expect(client.completeLogin()).rejects.toThrow('permission setup failed');
    expect(client.storage.getRecord()).toBeNull();
  });

  it('returns only unexpired access tokens and exposes refresh retrieval explicitly', async () => {
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    client.storage.save({
      accessToken: 'opaque-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 60_000,
      refreshToken: 'refresh-token',
    });
    await expect(client.getToken()).resolves.toBe('opaque-token');
    await expect(client.getRefreshToken()).resolves.toBe('refresh-token');
    client.storage.save({ accessToken: 'expired', tokenType: 'Bearer', expiresAt: Date.now() - 1 });
    await expect(client.getToken()).resolves.toBeNull();
  });

  it('restores granted scopes and loads a typed app profile without inspecting the access token', async () => {
    type AppProfile = { readonly id: string; readonly email: string | null };
    const loadProfile = vi.fn(async ({ accessToken }: { readonly accessToken: string }): Promise<AppProfile> => {
      expect(accessToken).toBe('opaque-token-that-is-not-a-jwt');
      return { id: 'user-7', email: null };
    });
    const client = createAuthClient<AppProfile>({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      loadProfile,
    });
    client.storage.save({
      accessToken: 'opaque-token-that-is-not-a-jwt',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 300_000,
      grantedScopes: ['projects.read'],
    });

    await client.initialize();

    expect(client.getSnapshot()).toMatchObject({
      status: 'authenticated',
      grantedScopes: ['projects.read'],
      profile: { id: 'user-7', email: null },
      profileStatus: 'loaded',
    });
    expect(client.getProfile()).toEqual({ id: 'user-7', email: null });
  });

  it('keeps a usable token when the optional profile loader fails', async () => {
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      loadProfile: async () => { throw new Error('profile offline'); },
    });
    client.storage.save({ accessToken: 'opaque-token', tokenType: 'Bearer', expiresAt: Date.now() + 300_000 });

    await client.initialize();

    expect(client.getSnapshot()).toMatchObject({
      status: 'authenticated',
      profile: null,
      profileStatus: 'error',
      profileError: { message: 'profile offline' },
    });
    await expect(client.getToken()).resolves.toBe('opaque-token');
  });

  it('coalesces refresh requests, rotates tokens, and preserves scope when omitted', async () => {
    const onTokenRenewed = vi.fn(async () => undefined);
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      hooks: { onTokenRenewed },
    });
    client.storage.save({
      accessToken: 'expired',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1,
      refreshToken: 'refresh-old',
      grantedScopes: ['projects.read'],
    });
    let releaseResponse: (() => void) | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      await new Promise<void>((resolve) => { releaseResponse = resolve; });
      return {
        ok: true,
        json: async () => ({
          access_token: 'renewed-opaque-token',
          token_type: 'Bearer',
          expires_in: 600,
          refresh_token: 'refresh-rotated',
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = client.silentRenewToken();
    const second = client.silentRenewToken();
    releaseResponse?.();
    await expect(Promise.all([first, second])).resolves.toEqual(['renewed-opaque-token', 'renewed-opaque-token']);
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1];
    const body = request?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-old');
    expect(body.get('client_id')).toBe(client.config.clientId);
    expect(client.storage.getRecord()).toMatchObject({
      accessToken: 'renewed-opaque-token',
      refreshToken: 'refresh-rotated',
      grantedScopes: ['projects.read'],
    });
    expect(onTokenRenewed).toHaveBeenCalledOnce();
  });

  it('returns null for invalid_grant but surfaces refresh network failures', async () => {
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    client.storage.save({ accessToken: 'expired', tokenType: 'Bearer', expiresAt: 0, refreshToken: 'refresh' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'invalid_grant' }) } as Response)));
    await expect(client.silentRenewToken()).resolves.toBeNull();
    expect(client.storage.getRecord()).toBeNull();

    client.storage.save({ accessToken: 'expired', tokenType: 'Bearer', expiresAt: 0, refreshToken: 'refresh' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network unavailable'); }));
    await expect(client.silentRenewToken()).rejects.toThrow('network unavailable');
  });

  it('runs a token operation once with its original arguments', async () => {
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    client.storage.save({ accessToken: 'usable', tokenType: 'Bearer', expiresAt: Date.now() + 300_000 });
    const operation = vi.fn(async (token: string, itemId: string) => `${token}:${itemId}`);
    const protectedOperation = client.withToken(operation);

    await expect(protectedOperation('item-42')).resolves.toEqual({
      status: 'completed',
      value: 'usable:item-42',
    });
    expect(operation).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledWith('usable', 'item-42');
  });

  it('awaits redirect preparation before navigating and never runs the operation', async () => {
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    const events: string[] = [];
    client.navigateTo = vi.fn((url: string) => { events.push(`navigate:${url}`); });
    const operation = vi.fn(async () => 'should not run');
    const result = await client.runWithToken(operation, {
      returnTo: () => '/drafts/7?tab=edit',
      onRedirectNeeded: async () => {
        await Promise.resolve();
        events.push('saved');
      },
    });

    expect(result).toEqual({ status: 'redirecting' });
    expect(events).toEqual(['saved', `navigate:${client.config.routeUrls.login}`]);
    expect(client.transactions.consumeReturnTo()).toBe('/drafts/7?tab=edit');
    expect(operation).not.toHaveBeenCalled();
  });

  it('does not navigate when pre-redirect work rejects or token renewal fails', async () => {
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    client.navigateTo = vi.fn();
    await expect(client.runWithToken(async () => 'unused', {
      onRedirectNeeded: async () => { throw new Error('save failed'); },
    })).rejects.toThrow('save failed');
    expect(client.navigateTo).not.toHaveBeenCalled();

    client.storage.save({ accessToken: 'expired', tokenType: 'Bearer', expiresAt: 0, refreshToken: 'refresh' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('refresh offline'); }));
    await expect(client.runWithToken(async () => 'unused')).rejects.toThrow('refresh offline');
    expect(client.navigateTo).not.toHaveBeenCalled();
  });

  it('clears only its own local session on an idempotent logout stage', async () => {
    const events: string[] = [];
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      hooks: {
        onLogoutStart: async () => { events.push('start'); },
        onLogout: async () => { events.push('complete'); },
      },
    });
    client.storage.save({ accessToken: 'token', tokenType: 'Bearer', expiresAt: Date.now() + 60_000, refreshToken: 'refresh' });
    client.setNavigationAdapter({
      navigate: ({ to, replace }) => { events.push(`navigate:${to}:${replace}`); },
      getLocation: () => `${window.location.pathname}${window.location.search}${window.location.hash}`,
      subscribe: () => () => undefined,
    });
    await client.logout({ returnTo: '/projects' });
    expect(events).toEqual([`navigate:${new URL(client.config.routeUrls.logout).pathname}:false`]);

    const first = client.completeLogout();
    const second = client.completeLogout();
    await expect(Promise.all([first, second])).resolves.toEqual([{ status: 'complete', returnTo: '/projects' }, { status: 'complete', returnTo: '/projects' }]);
    expect(events.slice(1)).toEqual(['start', 'complete']);
    expect(client.storage.getRecord()).toBeNull();
    expect(client.getSnapshot()).toMatchObject({ status: 'anonymous', profile: null, grantedScopes: null });
  });

  it('clears local credentials even when a logout observer fails', async () => {
    const onLogoutError = vi.fn(async () => undefined);
    const client = createAuthClient({
      clientId: `client-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      hooks: {
        onLogout: async () => { throw new Error('observer failed'); },
        onLogoutError,
      },
    });
    client.storage.save({ accessToken: 'token', tokenType: 'Bearer', expiresAt: Date.now() + 60_000 });

    await expect(client.completeLogout()).rejects.toThrow('observer failed');
    expect(client.storage.getRecord()).toBeNull();
    expect(client.getSnapshot().status).toBe('anonymous');
    expect(onLogoutError).toHaveBeenCalledWith({ code: 'LOGOUT_FAILED', message: 'observer failed', stage: 'logout' });
  });
});
