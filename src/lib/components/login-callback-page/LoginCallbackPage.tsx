import { useEffect, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { AuthError, LoginCallbackViewProps } from '@/types';
import type { AuthClient } from '@/services/auth-client/AuthClient';
import { AuthScreen } from '../auth-screen/AuthScreen';

type LoginCallbackPageProps<Profile> = {
  readonly client: AuthClient<Profile>;
  readonly View?: ComponentType<LoginCallbackViewProps>;
  readonly message?: string;
};

function DefaultLoginCallbackView({ status, error, message }: LoginCallbackViewProps & { readonly message?: string }): ReactElement {
  return <AuthScreen><p role={error === null ? 'status' : 'alert'}>
    {error?.message ?? (status === 'complete' ? 'Login complete.' : message ?? 'Logging in…')}
  </p></AuthScreen>;
}

export function LoginCallbackPage<Profile>({
  client,
  View,
  message,
}: LoginCallbackPageProps<Profile>): ReactElement {
  const [status, setStatus] = useState<LoginCallbackViewProps['status']>('processing');
  const [error, setError] = useState<AuthError | null>(null);

  useEffect(() => {
    let active = true;
    const entry = client.getAuthRouteSnapshot();
    void client.completeLogin().then(async (returnTo) => {
      if (!active || entry !== client.getAuthRouteSnapshot()) return;
      setStatus('complete');
      await client.navigateInternal(returnTo, true);
    }).catch(async (reason: unknown) => {
      if (!active || entry !== client.getAuthRouteSnapshot()) return;
      setStatus('error');
      setError(reason instanceof Error
        ? { code: 'LOGIN_CALLBACK_FAILED', message: reason.message }
        : { code: 'LOGIN_CALLBACK_FAILED', message: 'Login could not be completed.' });
      try {
        await client.clearCallbackParameters();
      } catch {
        // Keep the flow error visible if the router rejects URL cleanup.
      }
    });
    return () => { active = false; };
  }, [client]);

  return View === undefined
    ? <DefaultLoginCallbackView status={status} error={error} message={message} />
    : <View status={status} error={error} />;
}
