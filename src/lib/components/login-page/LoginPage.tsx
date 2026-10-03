import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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

function DefaultLoginView({ status, error, onRetry, message }: LoginViewProps & { readonly message?: string }): ReactElement {
  return <AuthScreen>
    <p role={error === null ? 'status' : 'alert'}>
      {error?.message ?? (status === 'cancelled'
        ? 'Login was cancelled. You can try again.'
        : message ?? 'Logging in…')}
    </p>
    {(status === 'cancelled' || status === 'error') && <button type="button" className="react-oauth-screen-action" onClick={onRetry}>Log in</button>}
  </AuthScreen>;
}

export function LoginPage<Profile>({ client, View, message }: LoginPageProps<Profile>): ReactElement {
  const [error, setError] = useState<AuthError | null>(null);
  const operation = useRef(0);
  const retrying = useRef(false);
  const route = useSyncExternalStore(client.subscribeAuthRoute, client.getAuthRouteSnapshot);

  const reportError = useCallback(async (
    reason: unknown, attempt: number, entry: ReturnType<AuthClient<Profile>['getAuthRouteSnapshot']>,
  ): Promise<void> => {
    if (attempt !== operation.current || entry !== client.getAuthRouteSnapshot()) return;
    const loginError = normalizeError(reason);
    retrying.current = false;
    setError(loginError);
    try {
      await client.config.hooks?.onLoginError?.({ ...loginError, stage: 'login' });
    } catch {
      // The stage error remains visible if an observer hook also fails.
    }
  }, [client]);

  const runLogin = useCallback((retry: boolean): void => {
    if (retry && retrying.current) return;
    retrying.current = true;
    const attempt = ++operation.current;
    const entry = client.getAuthRouteSnapshot();
    setError(null);
    try {
      const request = retry ? client.retryLogin() : client.enterLoginStage();
      void request.catch((reason: unknown) => reportError(reason, attempt, entry));
    } catch (reason: unknown) {
      void reportError(reason, attempt, entry);
    }
  }, [client, reportError]);

  const onRetry = useCallback((): void => { runLogin(true); }, [runLogin]);

  useEffect(() => {
    if (route.stage !== 'login') return;
    if (route.loginCancelled) {
      operation.current += 1;
      retrying.current = false;
    } else {
      runLogin(false);
    }
    return () => { operation.current += 1; };
  }, [route, runLogin]);

  const status: LoginViewProps['status'] = error !== null ? 'error' : route.loginCancelled ? 'cancelled' : 'redirecting';
  return View === undefined
    ? <DefaultLoginView status={status} error={error} onRetry={onRetry} message={message} />
    : <View status={status} error={error} onRetry={onRetry} />;
}

function normalizeError(reason: unknown): AuthError {
  if (reason instanceof Error) return { message: reason.message, code: 'LOGIN_START_FAILED' };
  return { message: 'Unable to start login.', code: 'LOGIN_START_FAILED' };
}
