import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoginViewProps } from '@/types';
import { createAuthClient } from '@/services/auth-client/AuthClient';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('shows a typed custom error when login start fails', async () => {
    const onLoginError = vi.fn(async () => undefined);
    const client = createAuthClient({
      clientId: `login-page-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      hooks: {
        onLoginStart: async () => { throw new Error('authorization setup failed'); },
        onLoginError,
      },
    });
    function CustomView({ status, error }: LoginViewProps): ReactElement {
      return <main>{error?.message ?? status}</main>;
    }

    render(<LoginPage client={client} View={CustomView} />);

    await waitFor(() => expect(screen.getByText('authorization setup failed')).toBeInTheDocument());
    expect(onLoginError).toHaveBeenCalledWith({
      code: 'LOGIN_START_FAILED', message: 'authorization setup failed', stage: 'login',
    });
    expect(client.transactions.consume()).toBeNull();
  });
});
