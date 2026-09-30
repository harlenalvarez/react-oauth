import type { PropsWithChildren, ReactElement } from 'react';
import type { AuthClient } from '@/services/auth-client/AuthClient';
import type { AuthMessages, AuthNavigationAdapter, AuthViews } from '@/types';
import { AuthBoundary } from './AuthBoundary';
import { AuthClientProvider } from './AuthClientProvider';

export type ReactAuthProviderProps<Profile> = PropsWithChildren<{
  readonly client: AuthClient<Profile>;
  readonly views?: AuthViews;
  readonly messages?: AuthMessages;
  readonly navigation?: AuthNavigationAdapter;
}>;

export function ReactAuthProvider<Profile>({
  client,
  views,
  messages,
  navigation,
  children,
}: ReactAuthProviderProps<Profile>): ReactElement {
  return (
    <AuthClientProvider client={client} navigation={navigation}>
      <AuthBoundary views={views} messages={messages}>{children}</AuthBoundary>
    </AuthClientProvider>
  );
}
