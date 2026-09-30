import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ComponentType } from 'react';
import type { AuthError, LoginViewProps } from '@/types';
import type { AuthClient } from '@/services/auth-client/AuthClient';
import { AuthScreen } from '../auth-screen/AuthScreen';

type LoginPageProps<Profile> = {
  readonly client: AuthClient<Profile>;
  readonly View?: ComponentType<LoginViewProps>;
  readonly message?: string;
};

function DefaultLoginView({ status, error, message }: LoginViewProps & { readonly message?: string }): ReactElement {
  return <AuthScreen><p role={error === null ? 'status' : 'alert'}>
    {error?.message ?? (status === 'redirecting' ? message ?? 'Taking you to log in…' : 'Unable to start login.')}
  </p></AuthScreen>;
}

export function LoginPage<Profile>({ client, View, message }: LoginPageProps<Profile>): ReactElement {
  const [error, setError] = useState<AuthError | null>(null);

  useEffect(() => {
    let active = true;
    const entry = client.getAuthRouteSnapshot();
    void client.enterLoginStage().catch(async (reason: unknown) => {
      if (!active || entry !== client.getAuthRouteSnapshot()) return;
      const loginError = normalizeError(reason);
      setError(loginError);
      try {
        await client.config.hooks?.onLoginError?.({ ...loginError, stage: 'login' });
      } catch {
        // The stage error remains visible if an observer hook also fails.
      }
    });
    return () => { active = false; };
  }, [client]);

  const status = error === null ? 'redirecting' : 'error';
  return View === undefined
    ? <DefaultLoginView status={status} error={error} message={message} />
    : <View status={status} error={error} />;
}

function normalizeError(reason: unknown): AuthError {
  if (reason instanceof Error) return { message: reason.message, code: 'LOGIN_START_FAILED' };
  return { message: 'Unable to start login.', code: 'LOGIN_START_FAILED' };
}
