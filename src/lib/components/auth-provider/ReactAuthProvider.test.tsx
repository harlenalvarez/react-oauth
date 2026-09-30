import { StrictMode } from 'react';
import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/context/useAuth';
import type { LoginViewProps } from '@/types';
import type { LogoutViewProps } from '@/types';
import { createAuthClient } from '@/services/auth-client/AuthClient';
import { ReactAuthProvider } from './ReactAuthProvider';

describe('ReactAuthProvider', () => {
  it('provides the shared client to consumers outside auth stages', async () => {
    const client = createAuthClient({
      clientId: `provider-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    function Consumer(): ReactElement {
      const auth = useAuth(client);
      return <span>{auth.status}</span>;
    }

    render(<ReactAuthProvider client={client}><Consumer /></ReactAuthProvider>);
    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());
  });

  it('renders the custom login view and starts one transaction under Strict Mode', async () => {
    const onLoginStart = vi.fn(async () => { throw new Error('fixture pause'); });
    const client = createAuthClient({
      clientId: `provider-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      hooks: { onLoginStart },
    });
    window.history.replaceState(null, '', '/login');
    function LoginView({ error }: LoginViewProps): ReactElement {
      return <main>{error?.message ?? 'Custom login view'}</main>;
    }

    render(
      <StrictMode>
        <ReactAuthProvider client={client} views={{ LoginView }}><span>App</span></ReactAuthProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText('fixture pause')).toBeInTheDocument());
    expect(onLoginStart).toHaveBeenCalledOnce();
    expect(screen.queryByText('App')).not.toBeInTheDocument();
    window.history.replaceState(null, '', '/');
  });

  it('intercepts logout, clears the local session, and replaces the route through the adapter', async () => {
    const onLogout = vi.fn(async () => undefined);
    const client = createAuthClient({
      clientId: `provider-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      hooks: { onLogout },
    });
    client.storage.save({ accessToken: 'local-token', tokenType: 'Bearer', expiresAt: Date.now() + 60_000 });
    window.history.replaceState(null, '', '/logout');
    const navigate = vi.fn();
    function CustomLogout({ status, error }: LogoutViewProps): ReactElement {
      return <main>{error?.message ?? status}</main>;
    }

    render(
      <ReactAuthProvider
        client={client}
        navigation={{
          navigate,
          getLocation: () => `${window.location.pathname}${window.location.search}${window.location.hash}`,
          subscribe: () => () => undefined,
        }}
        views={{ LogoutView: CustomLogout }}
      ><span>App</span></ReactAuthProvider>,
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true }));
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(onLogout).toHaveBeenCalledOnce();
    expect(client.storage.getRecord()).toBeNull();
    expect(screen.queryByText('App')).not.toBeInTheDocument();
    window.history.replaceState(null, '', '/');
  });
});
