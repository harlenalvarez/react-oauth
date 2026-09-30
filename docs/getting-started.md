# Getting started with React OAuth

`@huddle-ai/auth` handles authorization code login with PKCE, callback validation, token exchange, renewal, and local logout. Your app supplies its authorization server settings and remains responsible for its own UI and API calls.

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

`acquireToken()` saves the current internal URL as a return path before entering `/login`. You may supply `{ returnTo: '/projects/42?tab=activity' }`. External or invalid return targets fall back to the app root. A direct initial load of `/login` also returns to the app root. `logout()` clears local auth state through `/logout`; it does not end the identity provider's server session. Handle rejected navigation or protocol calls in your app's UI rather than leaving a button with an unhandled Promise.

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
