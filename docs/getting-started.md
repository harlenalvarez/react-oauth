# Getting started with React OAuth

`@huddle-ai/auth` handles authorization code login with PKCE, callback validation, token exchange, renewal, local logout, and optional provider session logout. Your app supplies its authorization server settings and remains responsible for its own UI and API calls.

React 19 or later is required. React is the only runtime peer dependency; your app supplies React DOM as usual. Install with `npm install @huddle-ai/auth` after the first publication, or follow [local installation](package-development.md) to test a built tarball. Imports below use the package's real public entry point. For the repository demo, run `npm ci`, then `npm run dev:mock` and `npm start` in separate terminals.

## 1. Create one client

Register `https://app.example.com/login-callback` as a callback URL for a public browser client at your identity provider. Its token endpoint must accept CORS requests from your app origin. Then create the client once at module scope:

```ts
// src/auth.ts
import { createAuthClient } from '@huddle-ai/auth';

export const authClient = createAuthClient({
  clientId: 'my-browser-app',
  authorizationEndpoint: 'https://identity.example.com/authorize',
  tokenEndpoint: 'https://identity.example.com/token',
  scopes: ['projects.read'],
});
```

The default app base is the current origin. The default paths are `/login`, `/login-callback`, and `/logout`. Configure `appBaseUrl`, `paths`, or `redirectUri` when needed. The actual callback URL must load the app with the auth provider mounted. See [router integration](router-integration.md) for apps hosted below a base path or using a router.

## 2. Wrap the app

```tsx
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactAuthProvider } from '@huddle-ai/auth';
import { authClient } from './auth';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <ReactAuthProvider client={authClient}>
      <App />
    </ReactAuthProvider>
  </StrictMode>,
);
```

Give the root full available width in your app stylesheet. The library includes its own auth-screen styles and does not reset the host's layout:

```css
/* src/index.css */
body { margin: 0; }
#root { width: 100%; min-height: 100vh; }
```

The provider displays auth screens at those three paths and renders `App` everywhere else. Default internal navigation updates browser history and dispatches `popstate`, without reloading the document. If you use React Router or TanStack Router, install the [router adapter](router-integration.md) before using this flow. The library does not require either router.

Redirecting to the authorization server and returning to the callback load documents. Configure your web server to serve the app at `/login-callback`. Auth screens unmount the app subtree. Put shared theme and router providers above the boundary, and save page state that must survive login before redirecting.

## 3. Offer login and logout

```tsx
import { useState } from 'react';
import { useAuth } from '@huddle-ai/auth';
import { authClient } from './auth';

export function AuthControls() {
  const { status, authError, acquireToken, logout } = useAuth(authClient);
  const [actionError, setActionError] = useState<string | null>(null);
  const run = (action: () => Promise<void>): void => {
    setActionError(null);
    void action().catch((reason: unknown) => {
      setActionError(reason instanceof Error ? reason.message : 'Auth navigation failed.');
    });
  };
  if (status === 'initializing') return <span>{authError?.message ?? 'Checking session…'}</span>;

  return <>
    {status === 'authenticated'
      ? <button type="button" onClick={() => run(logout)}>Log out</button>
      : <button type="button" onClick={() => run(acquireToken)}>Log in</button>}
    {actionError !== null && <p role="alert">{actionError}</p>}
  </>;
}
```

`acquireToken()` saves the current internal URL as a return path before entering `/login`. You may supply `{ returnTo: '/projects/42?tab=activity' }`. External or invalid return targets fall back to the app root. A direct initial load of `/login` also returns to the app root. `logout()` clears local auth state through `/logout`. Without an `endSessionEndpoint`, it returns to the app and leaves the identity provider's session active. Handle rejected navigation or protocol calls in your app's UI rather than leaving a button with an unhandled Promise.

### End the provider session

Configure `endSessionEndpoint` to let the library handle [OpenID Connect RP-Initiated Logout](https://openid.net/specs/openid-connect-rpinitiated-1_0.html). No consumer redirect hook is needed:

```ts
const authClient = createAuthClient({
  clientId: 'your-public-client-id',
  authorizationEndpoint: 'https://identity.example.com/oauth/v2/authorize',
  tokenEndpoint: 'https://identity.example.com/oauth/v2/token',
  endSessionEndpoint: 'https://identity.example.com/oidc/v1/end_session',
  postLogoutRedirectUri: 'https://app.example.com/logout',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  oidc: {
    issuer: 'https://identity.example.com',
    jwksUri: 'https://identity.example.com/oauth/v2/keys',
  },
});
```

Supply the exact values from your provider's discovery document; the library does not fetch discovery automatically. Register the **exact** `postLogoutRedirectUri` in the provider's allowed post-logout redirects, separately from the login callback. It defaults to the configured logout route, including `appBaseUrl`. A custom callback must be inside the same app origin/base path, distinct from login paths, and have no query or fragment. Serve the app and keep its auth boundary mounted on that path. Production endpoints use HTTPS; HTTP localhost is a development exception that also needs provider support.

On `/logout`, the library captures any stored ID token as `id_token_hint`, clears local credentials, and replaces the browser document with the provider's logout endpoint. It sends `client_id`, `post_logout_redirect_uri`, and a random `state`, then validates that state on return. This browser navigation does not use the router adapter or require a CORS fetch to the logout endpoint. With no ID token, the request identifies the client and the provider may ask for confirmation or refuse the return.

The return shows the default or custom `LogoutView` with `status: 'complete'` and stays on the logout completion page. `logout({ returnTo })` remains effective for local-only logout; it does not override provider logout's registered callback or trigger automatic navigation afterward. Reloading the completed page does not repeat logout. A new explicit `logout()` or login resets its marker. Missing, mismatched, expired, duplicated, or replayed state shows an error; an interrupted logout needs an explicit new logout to retry.

Provider confirmation, rejection, or availability can prevent a return. Local credentials remain cleared, and a matching callback is not a signed guarantee that every provider session ended. This feature does not revoke access or refresh tokens; [RFC 7009 token revocation](https://www.rfc-editor.org/rfc/rfc7009.html) is separate. OAuth providers without this OIDC logout endpoint keep local-only logout.

The lower-level `completeLogout()` now returns `LogoutResult`: `{ status: 'redirecting' }` or `{ status: 'complete', returnTo: string | null }`. The library page handles those results; consumers using this method directly must migrate from its previous string result.

## 4. Call a protected API

Use the same client outside React. The wrapped method receives a usable token and returns either a value or an explicit redirect result:

```ts
import { authClient } from './auth';

type Project = { id: string; name: string };

function isProject(value: unknown): value is Project {
  return typeof value === 'object' && value !== null &&
    'id' in value && typeof value.id === 'string' &&
    'name' in value && typeof value.name === 'string';
}

const fetchProject = async (token: string, id: string): Promise<Project> => {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Project request failed: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isProject(payload)) throw new Error('Invalid project response');
  return payload;
};

export const getProject = authClient.withToken(fetchProject);

export async function showProject(id: string): Promise<void> {
  const result = await getProject(id);
  if (result.status === 'redirecting') return;
  console.log(result.value.name);
}
```

`withToken` checks expiry, attempts one silent refresh, and invokes the API method once when a token is available. It never replays a request after an API 401 or 403. `runWithToken` supports an awaited `onRedirectNeeded` callback for saving page state before login. Network and protocol failures reject. See [token handling](token-handling.md) for lower-level methods and storage tradeoffs.

The [customization guide](customization.md) covers full-screen views, messages, and composable boundaries. [Profile and OIDC](profile-and-oidc.md) covers identity data. [Lifecycle hooks](lifecycle.md) covers app-specific work during the flow.

Before completing an integration, verify login, callback return, protected API access, logout, and Back/Forward. Use one module-scoped client and keep the provider mounted on all auth paths. Use the package's exported APIs; never implement token exchange in a custom view.
