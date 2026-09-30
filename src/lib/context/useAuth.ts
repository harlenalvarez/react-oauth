import { useContext, useSyncExternalStore } from 'react';
import { AuthContext } from './AuthContext';
import type { AuthClient } from '@/services/auth-client/AuthClient';
import type { AuthSnapshot, AuthStatus } from '@/types';

export type AuthHookValue<Profile> = AuthSnapshot<Profile> & Pick<
  AuthClient<Profile>,
  'acquireToken' | 'getToken' | 'getRefreshToken' | 'silentRenewToken' | 'getGrantedScopes'
  | 'runWithToken' | 'withToken' | 'getProfile' | 'logout' | 'getIdTokenClaims'
>;

export type AuthProfileState<Profile> = Pick<AuthSnapshot<Profile>, 'profile' | 'profileStatus' | 'profileError'>;

export function useAuthClient<Profile>(client: AuthClient<Profile>): AuthClient<Profile> {
  const providedClient = useContext(AuthContext);
  if (providedClient === null) throw new Error('useAuthClient must be used inside AuthClientProvider');
  if (providedClient !== client) throw new Error('useAuthClient client does not match AuthClientProvider');
  return client;
}

export function useAuth<Profile>(client: AuthClient<Profile>): AuthHookValue<Profile> {
  useAuthClient(client);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  return {
    ...snapshot,
    acquireToken: client.acquireToken,
    getToken: client.getToken,
    getRefreshToken: client.getRefreshToken,
    silentRenewToken: client.silentRenewToken,
    getGrantedScopes: client.getGrantedScopes,
    runWithToken: client.runWithToken,
    withToken: client.withToken,
    getProfile: client.getProfile,
    logout: client.logout,
    getIdTokenClaims: client.getIdTokenClaims,
  };
}

export function useAuthStatus<Profile>(client: AuthClient<Profile>): AuthStatus {
  useAuthClient(client);
  return useSyncExternalStore(client.subscribe, client.getStatusSnapshot);
}

export function useAuthProfile<Profile>(client: AuthClient<Profile>): AuthProfileState<Profile> {
  useAuthClient(client);
  return useSyncExternalStore(client.subscribe, client.getProfileSnapshot);
}
