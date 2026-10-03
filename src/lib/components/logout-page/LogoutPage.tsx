import type { ComponentType, ReactElement } from 'react';
import type { LogoutViewProps } from '@/types';
import type { AuthClient } from '@/services/auth-client/AuthClient';
import { AuthScreen } from '../auth-screen/AuthScreen';
import { useAuthStageRecovery } from '../auth-stage/useAuthStageRecovery';

type LogoutPageProps<Profile> = {
  readonly client: AuthClient<Profile>;
  readonly View?: ComponentType<LogoutViewProps>;
  readonly message?: string;
};

function DefaultLogoutView({ status, error, navigationError, onRetry, onContinue, message }: LogoutViewProps & { readonly message?: string }): ReactElement {
  return <AuthScreen>
    <p role={error === null ? 'status' : 'alert'}>
      {error?.message ?? (status === 'cancelled' ? 'Provider logout was not confirmed. You can try again.' : status === 'complete' ? 'Logged out.' : message ?? 'Logging out…')}
    </p>
    {navigationError !== null && <p role="alert">{navigationError.message}</p>}
    {navigationError !== null && <button type="button" className="react-oauth-screen-action" onClick={onContinue}>Continue</button>}
    {(status === 'cancelled' || status === 'error') && <button type="button" className="react-oauth-screen-action" onClick={onRetry}>Log out</button>}
  </AuthScreen>;
}

export function LogoutPage<Profile>({ client, View, message }: LogoutPageProps<Profile>): ReactElement {
  const props = useAuthStageRecovery(client, 'logout');

  return View === undefined
    ? <DefaultLogoutView {...props} message={message} />
    : <View {...props} />;
}
