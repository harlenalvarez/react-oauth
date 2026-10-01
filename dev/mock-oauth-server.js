import { createHash, createSign, createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = 4000;
const allowedOrigin = 'http://localhost:5173';
const authorizationCodes = new Map();
const refreshTokens = new Map();
const accessTokens = new Map();
const issuer = 'http://localhost:4000/';
const signingPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = {
  ...signingPair.publicKey.export({ format: 'jwk' }),
  kid: 'local-fixture-key',
  alg: 'RS256',
  use: 'sig',
};

const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  const requestUrl = new URL(request.url ?? '/', `http://${host}:${port}`);
  if (request.method === 'GET' && requestUrl.pathname === '/authorize') {
    authorize(requestUrl, response);
    return;
  }
  if ((request.method === 'GET' || request.method === 'POST') && requestUrl.pathname === '/end-session') {
    const parameters = request.method === 'POST' ? await readForm(request) : requestUrl.searchParams;
    endSession(parameters, response);
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/jwks') {
    sendJson(response, 200, { keys: [publicJwk] });
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/token') {
    const body = await readForm(request);
    issueToken(body, response);
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/profile') {
    if (!requireAccessToken(request.headers.authorization, response)) return;
    sendJson(response, 200, {
      id: 'fixture-user-1',
      email: 'developer@example.test',
      permissions: ['projects.read'],
    });
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname.startsWith('/api/projects/')) {
    if (!requireAccessToken(request.headers.authorization, response)) return;
    const id = decodeURIComponent(requestUrl.pathname.slice('/api/projects/'.length));
    sendJson(response, 200, { id, name: 'PKCE demo project' });
    return;
  }

  sendJson(response, 404, { error: 'not_found' });
});

server.listen(port, host, () => {
  console.log(`Local OAuth fixture listening at http://${host}:${port}`);
});

function authorize(url, response) {
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  const challenge = url.searchParams.get('code_challenge');
  const method = url.searchParams.get('code_challenge_method');
  const scope = url.searchParams.get('scope') ?? '';
  const nonce = url.searchParams.get('nonce') ?? undefined;
  if (url.searchParams.get('response_type') !== 'code' || !clientId || !redirectUri || !state || !challenge || method !== 'S256') {
    sendJson(response, 400, { error: 'invalid_request', error_description: 'Required authorization parameters are missing.' });
    return;
  }
  if (new URL(redirectUri).origin !== allowedOrigin) {
    sendJson(response, 400, { error: 'invalid_redirect_uri' });
    return;
  }

  const code = randomBytes(24).toString('base64url');
  if (scope.split(/\s+/).includes('openid') && !nonce) {
    sendJson(response, 400, { error: 'invalid_request', error_description: 'OIDC requires a nonce.' });
    return;
  }
  authorizationCodes.set(code, { clientId, redirectUri, state, challenge, scopes: scope.split(/\s+/).filter(Boolean), nonce });
  const callback = new URL(redirectUri);
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', state);
  response.writeHead(302, { Location: callback.href }).end();
}

function issueToken(form, response) {
  const grantType = form.get('grant_type');
  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const transaction = code ? authorizationCodes.get(code) : undefined;
    if (!transaction || transaction.clientId !== form.get('client_id') || transaction.redirectUri !== form.get('redirect_uri')) {
      sendJson(response, 400, { error: 'invalid_grant', error_description: 'Authorization code is invalid or already used.' });
      return;
    }
    authorizationCodes.delete(code);
    const verifier = form.get('code_verifier') ?? '';
    if (createChallenge(verifier) !== transaction.challenge) {
      sendJson(response, 400, { error: 'invalid_grant', error_description: 'PKCE verifier did not match.' });
      return;
    }
    sendToken(response, transaction.clientId, transaction.scopes, transaction.nonce);
    return;
  }

  if (grantType === 'refresh_token') {
    const oldToken = form.get('refresh_token');
    const session = oldToken ? refreshTokens.get(oldToken) : undefined;
    if (!session || session.clientId !== form.get('client_id')) {
      sendJson(response, 400, { error: 'invalid_grant', error_description: 'Refresh token is invalid or already rotated.' });
      return;
    }
    refreshTokens.delete(oldToken);
    const nextScopes = session.scopes.filter((scope) => scope !== 'profile');
    sendToken(response, session.clientId, nextScopes);
    return;
  }

  sendJson(response, 400, { error: 'unsupported_grant_type' });
}

function sendToken(response, clientId, scopes, nonce) {
  const accessToken = `fixture-access-${randomBytes(18).toString('base64url')}`;
  const refreshToken = `fixture-refresh-${randomBytes(18).toString('base64url')}`;
  accessTokens.set(accessToken, { clientId });
  refreshTokens.set(refreshToken, { clientId, scopes });
  sendJson(response, 200, {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 45,
    refresh_token: refreshToken,
    scope: scopes.join(' '),
    ...(scopes.includes('openid') ? { id_token: createIdToken(clientId, nonce) } : {}),
  });
}

function createIdToken(clientId, nonce) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', kid: 'local-fixture-key', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: issuer,
    aud: clientId,
    sub: 'fixture-user-1',
    exp: now + 3600,
    iat: now,
    ...(nonce === undefined ? {} : { nonce }),
    email: 'developer@example.test',
    email_verified: true,
    name: 'Local Fixture User',
  }));
  const signingInput = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(signingPair.privateKey).toString('base64url')}`;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function requireAccessToken(authorization, response) {
  const match = authorization?.match(/^Bearer (.+)$/);
  if (match && accessTokens.has(match[1])) return true;
  sendJson(response, 401, { error: 'invalid_token' });
  return false;
}

function createChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function readForm(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => resolve(new URLSearchParams(body)));
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

// Development-only RP-Initiated Logout fixture; not a production session provider.
function endSession(parameters, response) {
  const clientId = parameters.get('client_id');
  const callbackUri = parameters.get('post_logout_redirect_uri');
  const hint = parameters.get('id_token_hint');
  for (const name of ['client_id', 'post_logout_redirect_uri', 'id_token_hint', 'state']) {
    if (parameters.getAll(name).length > 1) {
      sendJson(response, 400, { error: 'invalid_request' });
      return;
    }
  }
  if (clientId !== 'local-consumer-demo' || callbackUri !== `${allowedOrigin}/logout`) {
    sendJson(response, 400, { error: 'invalid_logout_redirect' });
    return;
  }
  if (hint) {
    try {
      const [header, payload, signature, extra] = hint.split('.');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const signingHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
      const verifier = createVerify('RSA-SHA256').update(`${header}.${payload}`).end();
      if (extra !== undefined || signingHeader.alg !== 'RS256' || claims.iss !== issuer || claims.aud !== clientId ||
        !verifier.verify(signingPair.publicKey, Buffer.from(signature, 'base64url'))) throw new Error('Invalid hint');
    } catch {
      sendJson(response, 400, { error: 'invalid_id_token_hint' });
      return;
    }
  }
  const callback = new URL(callbackUri);
  const state = parameters.get('state');
  if (state !== null) callback.searchParams.set('state', state);
  response.writeHead(302, { Location: callback.href, 'Cache-Control': 'no-store' }).end();
}
