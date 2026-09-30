import { useState } from 'react';
import type { ReactElement } from 'react';
import {
  createAuthClient,
  ReactAuthProvider,
  useAuth,
} from '@huddle-ai/auth';
import './App.css';

type Project = { readonly id: string; readonly name: string };
type AppProfile = {
  readonly id: string;
  readonly email: string | null;
  readonly permissions: readonly string[];
};

const authClient = createAuthClient<AppProfile>({
  clientId: 'local-consumer-demo',
  authorizationEndpoint: 'http://localhost:4000/authorize',
  tokenEndpoint: 'http://localhost:4000/token',
  scopes: ['projects.read', 'profile'],
  oidc: {
    issuer: 'http://localhost:4000/',
    jwksUri: 'http://localhost:4000/jwks',
  },
  loadProfile: async ({ accessToken }): Promise<AppProfile> => {
    const response = await fetch('http://localhost:4000/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Profile request failed: ${response.status}`);
    const payload: unknown = await response.json();
    if (!isAppProfile(payload)) throw new Error('Invalid profile response');
    return payload;
  },
});

async function fetchProject(accessToken: string, projectId: string): Promise<Project> {
  const response = await fetch(`http://localhost:4000/api/projects/${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Project request failed: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isProject(payload)) throw new Error('Invalid project response');
  return payload;
}

const getProject = authClient.withToken(fetchProject);

function ConsumerHome(): ReactElement {
  const auth = useAuth(authClient);
  const [project, setProject] = useState<Project | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleLogin = async (): Promise<void> => auth.acquireToken();
  const handleLogout = async (): Promise<void> => auth.logout();
  const handleRefresh = async (): Promise<void> => {
    try {
      const token = await auth.silentRenewToken();
      setMessage(token === null ? 'No refresh token is available.' : 'Access token renewed.');
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Token renewal failed.');
    }
  };
  const handleLoadProject = async (): Promise<void> => {
    setMessage(null);
    try {
      const result = await getProject('42');
      if (result.status === 'redirecting') return;
      setProject(result.value);
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Project request failed.');
    }
  };

  if (auth.status === 'initializing') {
    return <main className="demo-shell" role={auth.authError === null ? undefined : 'alert'}>
      {auth.authError?.message ?? 'Checking session…'}
    </main>;
  }

  return (
    <main className="demo-shell">
      <p className="demo-eyebrow">React OAuth · local consumer</p>
      <h1>OAuth library demo</h1>
      <p>Session status: <strong>{auth.status}</strong>{auth.isRefreshing ? ' · renewing token' : ''}</p>
      {auth.status === 'authenticated' ? (
        <div className="demo-actions">
          <button type="button" onClick={handleLoadProject}>Load protected project</button>
          <button type="button" onClick={handleRefresh}>Renew token</button>
          <button type="button" onClick={handleLogout}>Log out</button>
        </div>
      ) : <button type="button" onClick={handleLogin}>Log in</button>}
      <section className="demo-panel" aria-live="polite">
        <h2>Granted scopes</h2>
        <p>{auth.grantedScopes === null ? 'Unknown' : auth.grantedScopes.join(', ') || 'No scopes granted'}</p>
      </section>
      <section className="demo-panel" aria-live="polite">
        <h2>App profile</h2>
        <p>{auth.profileStatus === 'error' ? auth.profileError?.message : auth.profile?.email ?? 'No profile loaded'}</p>
      </section>
      <section className="demo-panel" aria-live="polite">
        <h2>Verified OpenID Connect identity</h2>
        <p>{auth.idTokenClaims?.sub ?? 'No verified identity'}</p>
        <p>{auth.idTokenClaims?.email ?? 'Email is not provided'}</p>
        {auth.idTokenClaims?.email_verified !== undefined && <p>Email verified: {String(auth.idTokenClaims.email_verified)}</p>}
      </section>
      {project !== null && <section className="demo-panel"><h2>{project.name}</h2><p>Project {project.id}</p></section>}
      {message !== null && <p role="status">{message}</p>}
    </main>
  );
}

export default function App(): ReactElement {
  return <ReactAuthProvider client={authClient}><ConsumerHome /></ReactAuthProvider>;
}

function isAppProfile(value: unknown): value is AppProfile {
  return isRecord(value) && typeof value.id === 'string' &&
    (typeof value.email === 'string' || value.email === null) &&
    Array.isArray(value.permissions) && value.permissions.every(isString);
}

function isProject(value: unknown): value is Project {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
