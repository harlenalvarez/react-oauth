import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AuthError, LoginCallbackViewProps, LogoutViewProps } from '@/types';
import { AuthFlowError } from '@/services/auth-client/AuthClient';
import type { AuthClient } from '@/services/auth-client/AuthClient';

type RecoveryStage = 'loginCallback' | 'logout';
type StageStatus = LoginCallbackViewProps['status'] | LogoutViewProps['status'];

export function useAuthStageRecovery<Profile>(client: AuthClient<Profile>, stage: 'loginCallback'): LoginCallbackViewProps;
export function useAuthStageRecovery<Profile>(client: AuthClient<Profile>, stage: 'logout'): LogoutViewProps;
export function useAuthStageRecovery<Profile>(client: AuthClient<Profile>, stage: RecoveryStage): LoginCallbackViewProps | LogoutViewProps {
  const route = useSyncExternalStore(client.subscribeAuthRoute, client.getAuthRouteSnapshot);
  const [status, setStatus] = useState<StageStatus>(stage === 'logout' ? 'loggingOut' : 'processing');
  const [error, setError] = useState<AuthError | null>(null);
  const [navigationError, setNavigationError] = useState<AuthError | null>(null);
  const generation = useRef(0);
  const entryRef = useRef(route);
  const navigating = useRef(false);
  const retrying = useRef(false);
  const canRetry = useRef(false);
  const pendingNavigation = useRef<(() => Promise<void>) | null>(null);

  const runNavigation = useCallback(async (
    action: () => Promise<void>, attempt: number, entry: ReturnType<AuthClient<Profile>['getAuthRouteSnapshot']>,
  ): Promise<boolean> => {
    if (navigating.current || attempt !== generation.current || entry !== client.getAuthRouteSnapshot()) return false;
    navigating.current = true;
    setNavigationError(null);
    try {
      await action();
      return true;
    } catch (reason: unknown) {
      if (attempt === generation.current && entry === client.getAuthRouteSnapshot()) {
        setNavigationError(normalizeError(reason, 'AUTH_NAVIGATION_FAILED', 'The page could not be opened. You can try again.'));
      }
      return false;
    } finally {
      if (attempt === generation.current) navigating.current = false;
    }
  }, [client]);

  const onContinue = useCallback((): void => {
    const action = pendingNavigation.current;
    if (action !== null) void runNavigation(action, generation.current, entryRef.current);
  }, [runNavigation]);

  const onRetry = useCallback((): void => {
    if (!canRetry.current || retrying.current || navigating.current || entryRef.current !== client.getAuthRouteSnapshot()) return;
    retrying.current = true;
    const action = stage === 'logout' ? client.retryLogout : client.retryLogin;
    pendingNavigation.current = action;
    void runNavigation(action, generation.current, entryRef.current).then((succeeded) => {
      if (!succeeded) retrying.current = false;
    });
  }, [client, runNavigation, stage]);

  useEffect(() => {
    if (route.stage !== stage) return;
    const attempt = ++generation.current;
    const entry = client.getAuthRouteSnapshot();
    entryRef.current = entry;
    navigating.current = false;
    retrying.current = false;
    canRetry.current = false;
    pendingNavigation.current = null;
    setStatus(stage === 'logout' ? 'loggingOut' : 'processing');
    setError(null);
    setNavigationError(null);
    const request = stage === 'logout' ? client.completeLogout() : client.completeLogin();
    void request.then((result) => {
      if (attempt !== generation.current || entry !== client.getAuthRouteSnapshot()) return;
      if (result.status === 'redirecting') return;
      setStatus(result.status);
      canRetry.current = true;
      const returnTo = result.status === 'complete' ? result.returnTo : null;
      const action = () => client.continueAuthStage(returnTo);
      pendingNavigation.current = action;
      void runNavigation(action, attempt, entry);
    }, (reason: unknown) => {
      if (attempt !== generation.current || entry !== client.getAuthRouteSnapshot()) return;
      setStatus('error');
      setError(normalizeError(reason, stage === 'logout' ? 'LOGOUT_FAILED' : 'LOGIN_CALLBACK_FAILED', 'Authentication could not be completed.'));
      canRetry.current = true;
      const action = () => client.continueAuthStage(null);
      pendingNavigation.current = action;
      void runNavigation(action, attempt, entry);
    });
    return () => { generation.current += 1; };
  }, [client, stage, route, runNavigation]);

  return { status, error, navigationError, onContinue, onRetry } as LoginCallbackViewProps | LogoutViewProps;
}

function normalizeError(reason: unknown, fallbackCode: string, fallbackMessage: string): AuthError {
  return reason instanceof Error
    ? { code: reason instanceof AuthFlowError ? reason.code : fallbackCode, message: reason.message }
    : { code: fallbackCode, message: fallbackMessage };
}
