import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoginCallbackViewProps } from '@/types';
import { createAuthClient } from '@/services/auth-client/AuthClient';
import { LoginCallbackPage } from './LoginCallbackPage';

describe('LoginCallbackPage', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  });

  it('shows an error view and skips the exchange when callback state is invalid', async () => {
    const client = createAuthClient({
      clientId: `callback-page-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    client.transactions.save({ clientId: client.config.clientId, state: 'expected', verifier: 'verifier', createdAt: Date.now() });
    window.history.replaceState(null, '', '/login-callback?code=code&state=wrong');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    function CustomView({ status, error }: LoginCallbackViewProps): ReactElement {
      return <main>{error?.message ?? status}</main>;
    }

    render(<LoginCallbackPage client={client} View={CustomView} />);

    await waitFor(() => expect(screen.getByText('OAuth state did not match the login request.')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client.storage.getRecord()).toBeNull();
  });
});
