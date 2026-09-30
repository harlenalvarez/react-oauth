import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OidcOptions } from '@/types';
import { createAuthClient } from '@/services/auth-client/AuthClient';
import { OidcIdentity } from './OidcIdentity';

const issuer = 'https://identity.example.test';
const clientId = 'browser-client';
const nonce = 'transaction-nonce';

describe('OIDC ID token validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('verifies an RS256 signature and returns typed optional identity claims', async () => {
    const fixture = await createFixture({ iss: issuer, aud: clientId, sub: 'user-9', nonce, exp: futureSeconds(300), iat: pastSeconds(5) });
    vi.stubGlobal('fetch', jwksResponse(fixture.jwk));

    const claims = await new OidcIdentity(oidcOptions, clientId).validate(fixture.token, nonce);

    expect(claims).toMatchObject({ iss: issuer, sub: 'user-9', aud: clientId, nonce });
    expect(claims.email).toBeUndefined();
  });

  it('rejects unsupported algorithms, nonce mismatch, and issuer mismatch', async () => {
    const fixture = await createFixture({ iss: issuer, aud: clientId, sub: 'user-9', nonce, exp: futureSeconds(300), iat: pastSeconds(5) });
    vi.stubGlobal('fetch', jwksResponse(fixture.jwk));
    const identity = new OidcIdentity(oidcOptions, clientId);

    await expect(identity.validate(fixture.token, 'wrong-nonce')).rejects.toThrow('nonce did not match');
    const wrongIssuer = await createFixture({ iss: 'https://attacker.example', aud: clientId, sub: 'user-9', nonce, exp: futureSeconds(300), iat: pastSeconds(5) });
    await expect(identity.validate(wrongIssuer.token, nonce)).rejects.toThrow('issuer or audience did not match');
    const unsupported = await createFixture({ iss: issuer, aud: clientId, sub: 'user-9', nonce, exp: futureSeconds(300), iat: pastSeconds(5) }, 'none');
    await expect(identity.validate(unsupported.token, nonce)).rejects.toThrow('unsupported signing header');
  });

  it('rejects expired tokens, audience mismatches, and invalid signatures', async () => {
    const expired = await createFixture({ iss: issuer, aud: clientId, sub: 'user-9', nonce, exp: pastSeconds(300), iat: pastSeconds(500) });
    vi.stubGlobal('fetch', jwksResponse(expired.jwk));
    const identity = new OidcIdentity(oidcOptions, clientId);
    await expect(identity.validate(expired.token, nonce)).rejects.toThrow('time claims are invalid');

    const wrongAudience = await createFixture({ iss: issuer, aud: 'different-client', sub: 'user-9', nonce, exp: futureSeconds(300), iat: pastSeconds(5) });
    await expect(identity.validate(wrongAudience.token, nonce)).rejects.toThrow('issuer or audience did not match');

    const otherKey = await generateKeyPair();
    const valid = await createFixture({ iss: issuer, aud: clientId, sub: 'user-9', nonce, exp: futureSeconds(300), iat: pastSeconds(5) });
    const parts = valid.token.split('.');
    const tamperedSignature = `${parts[0]}.${parts[1]}.${parts[2].startsWith('A') ? 'B' : 'A'}${parts[2].slice(1)}`;
    vi.stubGlobal('fetch', jwksResponse(valid.jwk));
    await expect(identity.validate(tamperedSignature, nonce)).rejects.toThrow('signature is invalid');
    vi.stubGlobal('fetch', jwksResponse(await exportPublicJwk(otherKey.publicKey, 'rotated-key')));
    await expect(identity.validate(valid.token, nonce)).rejects.toThrow('signing key is missing or ambiguous');
  });

  it('loads the current signing key so key rotation is accepted', async () => {
    const rotated = await createFixture({ iss: issuer, aud: clientId, sub: 'user-9', nonce, exp: futureSeconds(300), iat: pastSeconds(5) }, 'RS256', 'rotated-key');
    vi.stubGlobal('fetch', jwksResponse(rotated.jwk));
    await expect(new OidcIdentity(oidcOptions, clientId).validate(rotated.token, nonce)).resolves.toMatchObject({ sub: 'user-9' });
  });

  it('commits OAuth tokens and exposes claims only after nonce-bound callback verification', async () => {
    const fixture = await createFixture({
      iss: issuer,
      aud: 'oidc-callback-client',
      sub: 'verified-subject',
      nonce,
      exp: futureSeconds(300),
      iat: pastSeconds(5),
      email: 'verified@example.test',
      email_verified: true,
    });
    const client = createAuthClient({
      clientId: 'oidc-callback-client',
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      oidc: { issuer, jwksUri: `${issuer}/jwks` },
    });
    client.transactions.save({ clientId: client.config.clientId, state: 'callback-state', verifier: 'verifier', createdAt: Date.now(), nonce });
    window.history.replaceState(null, '', '/login-callback?code=code&state=callback-state');
    const responses = [
      { ok: true, json: async () => ({ access_token: 'opaque-token', token_type: 'Bearer', expires_in: 300, id_token: fixture.token }) },
      { ok: true, json: async () => ({ keys: [fixture.jwk] }) },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift() as Response));

    await client.completeLogin();

    expect(client.storage.getRecord()).toMatchObject({ accessToken: 'opaque-token', idToken: fixture.token });
    expect(client.getIdTokenClaims()).toMatchObject({ sub: 'verified-subject', email: 'verified@example.test', email_verified: true });
  });
});

const oidcOptions: OidcOptions = { issuer, jwksUri: `${issuer}/jwks` };

async function createFixture(claims: Record<string, unknown>, algorithm = 'RS256', kid = 'fixture-key') {
  const pair = await generateKeyPair();
  const publicJwk = await exportPublicJwk(pair.publicKey, kid);
  const header = encodeSegment({ alg: algorithm, kid, typ: 'JWT' });
  const payload = encodeSegment(claims);
  const signed = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed));
  const bytes = Array.from(new Uint8Array(signature), (byte) => String.fromCharCode(byte)).join('');
  return { token: `${signed}.${btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`, jwk: publicJwk };
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
}

async function exportPublicJwk(key: CryptoKey, kid: string): Promise<JsonWebKey & { kid: string }> {
  return { ...await crypto.subtle.exportKey('jwk', key), kid, alg: 'RS256', use: 'sig' };
}

function encodeSegment(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwksResponse(jwk: JsonWebKey & { kid: string }) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk] }) } as Response));
}

function futureSeconds(amount: number): number {
  return Math.floor(Date.now() / 1000) + amount;
}

function pastSeconds(amount: number): number {
  return Math.floor(Date.now() / 1000) - amount;
}
