import type { AuthClientOptions, AuthPaths, NormalizedAuthConfig } from '@/types';

const defaultPaths: AuthPaths = {
  login: '/login',
  loginCallback: '/login-callback',
  logout: '/logout',
};

export function normalizeAuthConfig<Profile>(options: AuthClientOptions<Profile>): NormalizedAuthConfig<Profile> {
  if (typeof options.clientId !== 'string' || options.clientId.trim().length === 0) throw new Error('clientId is required');
  const authorizationEndpoint = validateEndpoint(options.authorizationEndpoint, 'authorizationEndpoint');
  const tokenEndpoint = validateEndpoint(options.tokenEndpoint, 'tokenEndpoint');
  const endSessionEndpoint = options.endSessionEndpoint === undefined
    ? undefined : validateEndpoint(options.endSessionEndpoint, 'endSessionEndpoint');
  if (endSessionEndpoint !== undefined && endSessionEndpoint.includes('#')) {
    throw new Error('endSessionEndpoint must not contain a hash');
  }
  if (options.postLogoutRedirectUri !== undefined && endSessionEndpoint === undefined) {
    throw new Error('postLogoutRedirectUri requires endSessionEndpoint');
  }
  const oidc = options.oidc === undefined ? undefined : {
    issuer: validateIssuer(options.oidc.issuer),
    jwksUri: validateEndpoint(options.oidc.jwksUri, 'oidc.jwksUri'),
    clockSkewSeconds: options.oidc.clockSkewSeconds,
  };
  if (oidc !== undefined) {
    if (oidc.clockSkewSeconds !== undefined &&
      (!Number.isFinite(oidc.clockSkewSeconds) || oidc.clockSkewSeconds < 0 || oidc.clockSkewSeconds > 60)) {
      throw new Error('oidc.clockSkewSeconds must be between 0 and 60');
    }
    const issuerUrl = new URL(oidc.issuer);
    if (issuerUrl.search || issuerUrl.hash) throw new Error('oidc.issuer must not contain a query or hash');
  }
  const base = new URL(options.appBaseUrl ?? `${window.location.origin}/`, window.location.origin);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && isLocalhost(base.hostname))) {
    throw new Error('appBaseUrl must use HTTPS (HTTP is allowed for localhost)');
  }
  if (base.username || base.password) throw new Error('appBaseUrl must not include URL credentials');
  if (base.search || base.hash) throw new Error('appBaseUrl must not contain a query or hash');
  if (!base.pathname.endsWith('/')) base.pathname += '/';

  const paths: AuthPaths = {
    login: validatePath(options.paths?.login ?? defaultPaths.login, 'login'),
    loginCallback: validatePath(options.paths?.loginCallback ?? defaultPaths.loginCallback, 'loginCallback'),
    logout: validatePath(options.paths?.logout ?? defaultPaths.logout, 'logout'),
  };
  const routeUrls = {
    login: resolveRoute(paths.login, base),
    loginCallback: resolveRoute(paths.loginCallback, base),
    logout: resolveRoute(paths.logout, base),
  };
  if (new Set(Object.values(routeUrls)).size !== 3) throw new Error('Auth stage paths must be distinct');
  const redirectUrl = options.redirectUri === undefined
    ? new URL(routeUrls.loginCallback)
    : new URL(options.redirectUri, base);
  if (redirectUrl.protocol !== 'https:' && !(redirectUrl.protocol === 'http:' && isLocalhost(redirectUrl.hostname))) {
    throw new Error('redirectUri must use HTTPS (HTTP is allowed for localhost)');
  }
  if (redirectUrl.username || redirectUrl.password) throw new Error('redirectUri must not include URL credentials');
  if (redirectUrl.search || redirectUrl.hash) throw new Error('redirectUri must not contain a query or hash');
  const redirectUri = redirectUrl.href;
  const logoutRedirect = endSessionEndpoint === undefined ? undefined
    : new URL(options.postLogoutRedirectUri ?? routeUrls.logout, base);
  if (logoutRedirect !== undefined) {
    validateEndpoint(logoutRedirect.href, 'postLogoutRedirectUri');
    if (logoutRedirect.href.includes('?') || logoutRedirect.href.includes('#')) throw new Error('postLogoutRedirectUri must not contain a query or hash');
    if (logoutRedirect.origin !== base.origin || !logoutRedirect.pathname.startsWith(base.pathname)) {
      throw new Error('postLogoutRedirectUri must stay inside appBaseUrl');
    }
    if ([routeUrls.login, routeUrls.loginCallback, redirectUri, base.href].includes(logoutRedirect.href)) {
      throw new Error('postLogoutRedirectUri must not conflict with login paths or the app root');
    }
  }
  if (options.scopes?.some((scope) => typeof scope !== 'string')) throw new Error('scopes must contain strings');
  const scopes = options.scopes?.map((scope) => scope.trim());
  if (scopes?.some((scope) => scope.length === 0)) {
    throw new Error('scopes must contain non-empty strings');
  }

  return {
    ...options,
    authorizationEndpoint,
    tokenEndpoint,
    endSessionEndpoint,
    postLogoutRedirectUri: logoutRedirect?.href,
    scopes: scopes === undefined
      ? (oidc === undefined ? undefined : ['openid'])
      : [...new Set(oidc === undefined || scopes.includes('openid') ? scopes : ['openid', ...scopes])],
    oidc,
    appBaseUrl: base.href,
    redirectUri,
    paths,
    routeUrls,
  };
}

export function isAllowedReturnTo<Profile>(value: string | undefined, config: NormalizedAuthConfig<Profile>): string {
  const fallback = new URL(config.appBaseUrl).pathname;
  if (value === undefined || value.trim() === '') return fallback;

  try {
    const base = new URL(config.appBaseUrl);
    const target = new URL(value, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) return fallback;
    if (Object.values(config.routeUrls).some((route) => new URL(route).pathname === target.pathname)) return fallback;
    if (new URL(config.redirectUri).pathname === target.pathname) return fallback;
    if (config.postLogoutRedirectUri !== undefined && new URL(config.postLogoutRedirectUri).pathname === target.pathname) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

function validateEndpoint(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost(url.hostname))) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed for localhost)`);
  }
  if (url.username || url.password) throw new Error(`${name} must not include URL credentials`);
  return url.href;
}

function validateIssuer(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('oidc.issuer must be an absolute URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost(url.hostname))) {
    throw new Error('oidc.issuer must use HTTPS (HTTP is allowed for localhost)');
  }
  if (url.username || url.password) throw new Error('oidc.issuer must not include URL credentials');
  if (url.search || url.hash) throw new Error('oidc.issuer must not contain a query or hash');
  return value;
}

function validatePath(value: string, name: string): string {
  if (value.trim().length === 0 || value.includes('?') || value.includes('#') || value.includes('\\') || value.startsWith('//')) {
    throw new Error(`paths.${name} must be a relative path without query or hash`);
  }
  return value;
}

function stripLeadingSlash(path: string): string {
  return path.replace(/^\/+/, '');
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function resolveRoute(path: string, base: URL): string {
  const route = new URL(stripLeadingSlash(path), base);
  if (route.origin !== base.origin || !route.pathname.startsWith(base.pathname)) {
    throw new Error('Auth stage paths must stay inside appBaseUrl');
  }
  return route.href;
}
