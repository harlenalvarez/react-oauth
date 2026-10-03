import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogoutViewProps } from '@/types';
import { createAuthClient } from '@/services/auth-client/AuthClient';
import { LogoutPage } from './LogoutPage';

describe('LogoutPage', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('clears tokens and uses the custom view before replacing to the app root', async () => {
    window.history.replaceState(null, '', '/logout');
    const client = createAuthClient({
      clientId: `logout-page-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    client.storage.save({ accessToken: 'local-token', tokenType: 'Bearer', expiresAt: Date.now() + 60_000 });
    const navigate = vi.fn();
    client.setNavigationAdapter({
      navigate,
      getLocation: () => `${window.location.pathname}${window.location.search}${window.location.hash}`,
      subscribe: () => () => undefined,
    });
    function CustomView({ status, error }: LogoutViewProps): ReactElement {
      return <main>{error?.message ?? status}</main>;
    }

    render(<LogoutPage client={client} View={CustomView} />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true }));
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(client.storage.getRecord()).toBeNull();
  });
});
