import type { ReactElement } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthClientProvider } from '@/components/auth-provider/AuthClientProvider';
import { createAuthClient } from '@/services/auth-client/AuthClient';
import { useAuthClient, useAuthProfile, useAuthStatus } from './useAuth';

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('focused auth subscriptions', () => {
  it('does not notify on unchanged stored scopes', async () => {
    const client = createAuthClient({
      clientId: crypto.randomUUID(),
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
    });
    client.storage.save({
      accessToken: 'token', tokenType: 'Bearer', expiresAt: Date.now() + 600000,
      grantedScopes: ['read'],
    });
    await client.getToken();
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);
    await client.getToken();
    await client.getToken();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps action-only and status readers stable when a profile loads', async () => {
    let finishProfile: ((value: { id: string }) => void) | undefined;
    const loadProfile = vi.fn(() => new Promise<{ id: string }>((resolve) => { finishProfile = resolve; }));
    const client = createAuthClient({
      clientId: crypto.randomUUID(),
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      loadProfile,
    });
    client.storage.save({ accessToken: 'token', tokenType: 'Bearer', expiresAt: Date.now() + 600000 });
    let actionsRenders = 0;
    let statusRenders = 0;
    let profileRenders = 0;
    function Actions(): ReactElement {
      useAuthClient(client);
      actionsRenders += 1;
      return <span>Actions</span>;
    }
    function Status(): ReactElement {
      const status = useAuthStatus(client);
      statusRenders += 1;
      return <span>Status: {status}</span>;
    }
    function Profile(): ReactElement {
      const profile = useAuthProfile(client);
      profileRenders += 1;
      return <span>Profile: {profile.profile?.id ?? profile.profileStatus}</span>;
    }
    render(<AuthClientProvider client={client}><Actions /><Status /><Profile /></AuthClientProvider>);
    await waitFor(() => expect(loadProfile).toHaveBeenCalledOnce());
    expect(screen.getByText('Status: authenticated')).toBeInTheDocument();
    const before = { actionsRenders, statusRenders, profileRenders };
    await act(async () => { finishProfile?.({ id: 'person-1' }); });
    expect(screen.getByText('Profile: person-1')).toBeInTheDocument();
    expect(actionsRenders).toBe(before.actionsRenders);
    expect(statusRenders).toBe(before.statusRenders);
    expect(profileRenders).toBeGreaterThan(before.profileRenders);
  });
});
