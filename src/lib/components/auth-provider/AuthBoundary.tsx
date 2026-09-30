import { useContext, useSyncExternalStore } from 'react';
import type { PropsWithChildren, ReactElement } from 'react';
import { AuthContext } from '@/context/AuthContext';
import type { AuthMessages, AuthViews } from '@/types';
import { LoginPage } from '../login-page/LoginPage';
import { LoginCallbackPage } from '../login-callback-page/LoginCallbackPage';
import { LogoutPage } from '../logout-page/LogoutPage';

export type AuthBoundaryProps = PropsWithChildren<{
  readonly views?: AuthViews;
  readonly messages?: AuthMessages;
}>;

export function AuthBoundary({ views, messages, children }: AuthBoundaryProps): ReactElement {
  const client = useContext(AuthContext);
  if (client === null) throw new Error('AuthBoundary must be used inside AuthClientProvider');
  const { stage, entry } = useSyncExternalStore(client.subscribeAuthRoute, client.getAuthRouteSnapshot);

  if (stage === 'login') {
    return <LoginPage key={entry} client={client} View={views?.LoginView} message={messages?.login} />;
  }
  if (stage === 'loginCallback') {
    return <LoginCallbackPage key={entry} client={client} View={views?.LoginCallbackView} message={messages?.loginCallback} />;
  }
  if (stage === 'logout') {
    return <LogoutPage key={entry} client={client} View={views?.LogoutView} message={messages?.logout} />;
  }
  return <>{children}</>;
}
