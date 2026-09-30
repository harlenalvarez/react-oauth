import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTokenStorage } from './TokenStorage';

describe('Token storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('returns one storage instance per client id', () => {
    expect(getTokenStorage('123')).toBe(getTokenStorage('123'));
    expect(getTokenStorage('123')).not.toBe(getTokenStorage('234'));
  });

  it('stores the verifier and challenge in client-namespaced local storage', () => {
    const storage = getTokenStorage('123');
    storage.Verifier = 'verifier';
    storage.Challenge = 'challenge';

    expect(localStorage.getItem('react-oauth:pkce-verifier:123')).toBe('verifier');
    expect(localStorage.getItem('react-oauth:pkce-challenge:123')).toBe('challenge');

    storage.Verifier = '';
    storage.Challenge = '';
    expect(localStorage.getItem('react-oauth:pkce-verifier:123')).toBeNull();
    expect(localStorage.getItem('react-oauth:pkce-challenge:123')).toBeNull();
  });

  it('stores and retrieves tokens as plain namespaced values', async () => {
    const storage = getTokenStorage('123');
    await storage.setAccessToken('access');
    await storage.setRefreshToken('refresh');
    await storage.setIdToken('identity');

    expect(JSON.parse(localStorage.getItem('react-oauth:tokens:123') ?? 'null')).toEqual({
      accessToken: 'access',
      tokenType: 'Bearer',
      expiresAt: 0,
      refreshToken: 'refresh',
      idToken: 'identity',
    });
    await expect(storage.getAccessToken()).resolves.toBe('access');
    await expect(storage.getRefreshToken()).resolves.toBe('refresh');
    await expect(storage.getIdToken()).resolves.toBe('identity');
  });

  it('removes token values when cleared', async () => {
    const storage = getTokenStorage('123');
    await storage.setAccessToken('access');
    await storage.setRefreshToken('refresh');
    await storage.setIdToken('identity');

    await storage.setAccessToken('');
    await storage.setRefreshToken('');
    await storage.setIdToken('');

    expect(localStorage.getItem('react-oauth:tokens:123')).toBeNull();
  });
});
