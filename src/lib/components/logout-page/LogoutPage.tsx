import { useEffect, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';
import type { AuthError, LogoutViewProps } from '@/types';
import type { AuthClient } from '@/services/auth-client/AuthClient';
import { AuthFlowError } from '@/services/auth-client/AuthClient';
import { AuthScreen } from '../auth-screen/AuthScreen';

type LogoutPageProps<Profile> = {
  readonly client: AuthClient<Profile>;
  readonly View?: ComponentType<LogoutViewProps>;
  readonly message?: string;
};

function DefaultLogoutView({ status, error, message }: LogoutViewProps & { readonly message?: string }): ReactElement {
  return <AuthScreen><p role={error === null ? 'status' : 'alert'}>
    {error?.message ?? (status === 'complete' ? 'Logged out.' : message ?? 'Logging out…')}
  </p></AuthScreen>;
}

export function LogoutPage<Profile>({ client, View, message }: LogoutPageProps<Profile>): ReactElement {
  const [status, setStatus] = useState<LogoutViewProps['status']>('loggingOut');
  const [error, setError] = useState<AuthError | null>(null);

  useEffect(() => {
    let active = true;
    const entry = client.getAuthRouteSnapshot();
    void client.completeLogout().then(async (result) => {
      if (!active || entry !== client.getAuthRouteSnapshot()) return;
      if (result.status === 'redirecting') return;
      setStatus('complete');
      if (result.returnTo !== null) await client.navigateInternal(result.returnTo, true);
    }).catch((reason: unknown) => {
      if (!active || entry !== client.getAuthRouteSnapshot()) return;
      setStatus('error');
      setError(reason instanceof Error
        ? { code: reason instanceof AuthFlowError ? reason.code : 'LOGOUT_FAILED', message: reason.message }
        : { code: 'LOGOUT_FAILED', message: 'Logout could not be completed.' });
    });
    return () => { active = false; };
  }, [client]);

  return View === undefined
    ? <DefaultLogoutView status={status} error={error} message={message} />
    : <View status={status} error={error} />;
}
