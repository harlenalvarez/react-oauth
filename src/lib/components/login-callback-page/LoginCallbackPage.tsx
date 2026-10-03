import type { ComponentType, ReactElement } from 'react';
import type { LoginCallbackViewProps } from '@/types';
import type { AuthClient } from '@/services/auth-client/AuthClient';
import { AuthScreen } from '../auth-screen/AuthScreen';
import { useAuthStageRecovery } from '../auth-stage/useAuthStageRecovery';

type LoginCallbackPageProps<Profile> = {
  readonly client: AuthClient<Profile>;
  readonly View?: ComponentType<LoginCallbackViewProps>;
  readonly message?: string;
};

function DefaultLoginCallbackView({ status, error, navigationError, onRetry, onContinue, message }: LoginCallbackViewProps & { readonly message?: string }): ReactElement {
  return <AuthScreen>
    <p role={error === null ? 'status' : 'alert'}>
      {error?.message ?? (status === 'cancelled' ? 'Login was cancelled. You can try again.' : status === 'complete' ? 'Login complete.' : message ?? 'Logging in…')}
    </p>
    {navigationError !== null && <p role="alert">{navigationError.message}</p>}
    {navigationError !== null && <button type="button" className="react-oauth-screen-action" onClick={onContinue}>Continue</button>}
    {(status === 'cancelled' || status === 'error') && <button type="button" className="react-oauth-screen-action" onClick={onRetry}>Log in</button>}
  </AuthScreen>;
}

export function LoginCallbackPage<Profile>({
  client,
  View,
  message,
}: LoginCallbackPageProps<Profile>): ReactElement {
  const props = useAuthStageRecovery(client, 'loginCallback');

  return View === undefined
    ? <DefaultLoginCallbackView {...props} message={message} />
    : <View {...props} />;
}
