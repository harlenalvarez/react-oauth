import { useEffect, useLayoutEffect } from 'react';
import type { PropsWithChildren, ReactElement } from 'react';
import { AuthContext } from '@/context/AuthContext';
import type { AuthClient } from '@/services/auth-client/AuthClient';
import type { AuthNavigationAdapter } from '@/types';

export type AuthClientProviderProps<Profile> = PropsWithChildren<{
  readonly client: AuthClient<Profile>;
  readonly navigation?: AuthNavigationAdapter;
}>;

export function AuthClientProvider<Profile>({
  client,
  navigation,
  children,
}: AuthClientProviderProps<Profile>): ReactElement {
  useLayoutEffect(() => {
    return client.observeNavigation(navigation);
  }, [client, navigation]);

  useEffect(() => {
    void client.initialize();
  }, [client]);

  return <AuthContext.Provider value={client}>{children}</AuthContext.Provider>;
}
