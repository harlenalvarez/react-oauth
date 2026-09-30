# App profile and OpenID Connect identity

Use `loadProfile` for application-specific identity or permissions. It receives a usable access token, calls your endpoint, and validates its payload. Profile loading runs after login and may run after restoration or renewal. A profile failure appears in `profileStatus`/`profileError` without discarding a usable OAuth token. `getProfile()` and `useAuthProfile(client)` expose the result.

```ts
type AppProfile = { id: string; email: string | null };

const authClient = createAuthClient<AppProfile>({
  clientId: 'my-browser-app',
  authorizationEndpoint: 'https://identity.example.com/authorize',
  tokenEndpoint: 'https://identity.example.com/token',
  loadProfile: async ({ accessToken }) => {
    const response = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Profile request failed: ${response.status}`);
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null ||
      !('id' in payload) || typeof payload.id !== 'string' ||
      !('email' in payload) || !(typeof payload.email === 'string' || payload.email === null)) {
      throw new Error('Invalid profile response');
    }
    return { id: payload.id, email: payload.email };
  },
});
```

OAuth access tokens are opaque. The library never decodes one to infer a user ID, email, role, or scope. If the provider supports OpenID Connect, opt in with a trusted issuer and JWKS URL:

```ts
oidc: {
  issuer: 'https://identity.example.com',
  jwksUri: 'https://identity.example.com/.well-known/jwks.json',
}
```

OIDC mode requests `openid`, includes a per-transaction nonce, and verifies RS256 ID-token signatures and issuer, audience, authorized party, time, and nonce claims before exposing `idTokenClaims`. Optional claims such as email remain optional. OAuth-only mode does not expose an ID token as verified identity. During restoration, a JWKS availability failure remains visible in `authError` while credentials are retained for retry.
