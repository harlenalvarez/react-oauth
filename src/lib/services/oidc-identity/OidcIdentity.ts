import type { OidcOptions, VerifiedIdTokenClaims } from '@/types';

type RsaJwk = JsonWebKey & {
  readonly kid: string;
  readonly kty: 'RSA';
  readonly n: string;
  readonly e: string;
  readonly alg?: string;
  readonly use?: string;
};

export class OidcIdentity {
  constructor(private readonly options: OidcOptions, private readonly clientId: string) {}

  async validate(idToken: string, expectedNonce?: string): Promise<VerifiedIdTokenClaims> {
    if (idToken.length > 16_384) throw new OidcValidationError('ID token exceeds the supported size.');
    const parts = idToken.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      throw new OidcValidationError('ID token is not a compact signed JWT.');
    }
    const header = parseJsonSegment(parts[0]);
    if (!isRecord(header) || header.alg !== 'RS256' || typeof header.kid !== 'string' ||
      header.jku !== undefined || header.x5u !== undefined || header.crit !== undefined) {
      throw new OidcValidationError('ID token uses an unsupported signing header.');
    }
    const claimsValue = parseJsonSegment(parts[1]);
    if (!isRecord(claimsValue)) throw new OidcValidationError('ID token claims are malformed.');
    const claims = validateClaims(claimsValue, this.options, this.clientId, expectedNonce);

    const jwk = await this.findKey(header.kid);
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    if (key.algorithm.name !== 'RSASSA-PKCS1-v1_5' ||
      !('modulusLength' in key.algorithm) || typeof key.algorithm.modulusLength !== 'number' ||
      key.algorithm.modulusLength < 2048) {
      throw new OidcValidationError('ID token signing key is below the supported RSA size.');
    }
    const signature = decodeBase64Url(parts[2]);
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
    if (!verified) throw new OidcValidationError('ID token signature is invalid.');
    return claims;
  }

  private async findKey(kid: string): Promise<RsaJwk> {
    const response = await fetch(this.options.jwksUri, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new OidcKeySetError(`JWKS request failed: ${response.status}.`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.keys)) throw new OidcKeySetError('JWKS response is malformed.');
    const candidates = payload.keys.filter((entry: unknown) => isRecord(entry) && entry.kid === kid);
    if (candidates.length !== 1 || !isRsaJwk(candidates[0])) {
      throw new OidcKeySetError('ID token signing key is missing or ambiguous.');
    }
    const match = candidates[0];
    if ((match.use !== undefined && match.use !== 'sig') || (match.alg !== undefined && match.alg !== 'RS256')) {
      throw new OidcKeySetError('ID token signing key is not valid for RS256 signatures.');
    }
    return match;
  }
}

export class OidcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcValidationError';
  }
}

export class OidcKeySetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcKeySetError';
  }
}

function validateClaims(
  payload: Record<string, unknown>,
  options: OidcOptions,
  clientId: string,
  expectedNonce: string | undefined,
): VerifiedIdTokenClaims {
  const skew = Math.min(Math.max(options.clockSkewSeconds ?? 60, 0), 60);
  const now = Math.floor(Date.now() / 1000);
  const audiences = typeof payload.aud === 'string'
    ? [payload.aud]
    : Array.isArray(payload.aud) && payload.aud.every((entry: unknown) => typeof entry === 'string')
      ? payload.aud as string[]
      : null;
  if (payload.iss !== options.issuer || audiences === null || !audiences.includes(clientId)) {
    throw new OidcValidationError('ID token issuer or audience did not match.');
  }
  if (audiences.length > 1 && payload.azp !== clientId) throw new OidcValidationError('ID token authorized party did not match.');
  if (payload.azp !== undefined && payload.azp !== clientId) throw new OidcValidationError('ID token authorized party did not match.');
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= now - skew ||
    typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > now + skew ||
    typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new OidcValidationError('ID token subject or time claims are invalid.');
  }
  if (expectedNonce !== undefined && payload.nonce !== expectedNonce) {
    throw new OidcValidationError('ID token nonce did not match the login transaction.');
  }
  if (payload.nonce !== undefined && typeof payload.nonce !== 'string') throw new OidcValidationError('ID token nonce is malformed.');
  if (payload.email !== undefined && typeof payload.email !== 'string') throw new OidcValidationError('ID token email claim is malformed.');
  if (payload.email_verified !== undefined && typeof payload.email_verified !== 'boolean') throw new OidcValidationError('ID token email_verified claim is malformed.');
  if (payload.name !== undefined && typeof payload.name !== 'string') throw new OidcValidationError('ID token name claim is malformed.');
  if (payload.picture !== undefined && typeof payload.picture !== 'string') throw new OidcValidationError('ID token picture claim is malformed.');

  return {
    iss: options.issuer,
    aud: audiences.length === 1 ? audiences[0] : audiences,
    sub: payload.sub,
    exp: payload.exp,
    iat: payload.iat,
    ...(typeof payload.nonce === 'string' ? { nonce: payload.nonce } : {}),
    ...(typeof payload.azp === 'string' ? { azp: payload.azp } : {}),
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    ...(typeof payload.email_verified === 'boolean' ? { email_verified: payload.email_verified } : {}),
    ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    ...(typeof payload.picture === 'string' ? { picture: payload.picture } : {}),
  };
}

function parseJsonSegment(segment: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment))) as unknown;
  } catch {
    throw new OidcValidationError('ID token contains invalid base64url JSON.');
  }
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRsaJwk(value: unknown): value is RsaJwk {
  return isRecord(value) && value.kty === 'RSA' && typeof value.kid === 'string' &&
    typeof value.n === 'string' && value.n.length >= 342 && value.n.length <= 2048 &&
    typeof value.e === 'string' && value.e.length > 0 && value.e.length <= 16 &&
    (value.alg === undefined || typeof value.alg === 'string') &&
    (value.use === undefined || typeof value.use === 'string');
}
