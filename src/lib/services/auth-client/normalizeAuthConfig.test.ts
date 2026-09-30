import { describe, expect, it } from 'vitest';
import { isAllowedReturnTo, normalizeAuthConfig } from './normalizeAuthConfig';

const baseOptions = {
  clientId: 'test-client',
  authorizationEndpoint: 'https://identity.example.com/authorize',
  tokenEndpoint: 'https://identity.example.com/token',
};

describe('auth config normalization', () => {
  it('uses default auth routes and callback URL at the app base', () => {
    const config = normalizeAuthConfig({ ...baseOptions, appBaseUrl: 'https://app.example.test/workspace/' });
    expect(config.routeUrls).toEqual({
      login: 'https://app.example.test/workspace/login',
      loginCallback: 'https://app.example.test/workspace/login-callback',
      logout: 'https://app.example.test/workspace/logout',
    });
    expect(config.redirectUri).toBe(config.routeUrls.loginCallback);
  });

  it('accepts localhost HTTP endpoints but requires HTTPS elsewhere', () => {
    expect(normalizeAuthConfig({
      ...baseOptions,
      authorizationEndpoint: 'http://localhost:4000/authorize',
    }).authorizationEndpoint).toBe('http://localhost:4000/authorize');
    expect(() => normalizeAuthConfig({ ...baseOptions, tokenEndpoint: 'http://identity.example.com/token' }))
      .toThrow('tokenEndpoint must use HTTPS');
  });

  it('accepts only internal return targets outside auth routes', () => {
    const config = normalizeAuthConfig({ ...baseOptions, appBaseUrl: 'https://app.example.test/workspace/' });
    expect(isAllowedReturnTo('/workspace/projects/42?tab=activity#notes', config))
      .toBe('/workspace/projects/42?tab=activity#notes');
    expect(isAllowedReturnTo('https://attacker.example/steal', config)).toBe('/workspace/');
    expect(isAllowedReturnTo('/elsewhere', config)).toBe('/workspace/');
    expect(isAllowedReturnTo('/workspace/login', config)).toBe('/workspace/');
  });

  it('does not return to an explicit callback path outside the default stage routes', () => {
    const config = normalizeAuthConfig({
      ...baseOptions,
      appBaseUrl: 'https://app.example.test/workspace/',
      redirectUri: 'https://app.example.test/workspace/oauth/return',
    });
    expect(isAllowedReturnTo('/workspace/oauth/return?code=old&state=old#fragment', config)).toBe('/workspace/');
  });
});
