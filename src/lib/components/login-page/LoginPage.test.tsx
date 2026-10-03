import { StrictMode } from 'react';
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginViewProps } from '@/types';
import { createAuthClient } from '@/services/auth-client/AuthClient';
import { ReactAuthProvider } from '../auth-provider/ReactAuthProvider';
import { LoginPage } from './LoginPage';

const realWindow = window;
const realPerformance = performance;
let assign: ReturnType<typeof vi.fn>;
let navigationType: PerformanceNavigationTiming['type'];

function makeClient() {
  const onLoginStart = vi.fn();
  const onLoginError = vi.fn();
  const client = createAuthClient({
    clientId: `login-page-${crypto.randomUUID()}`,
    authorizationEndpoint: 'https://identity.example.com/authorize',
    tokenEndpoint: 'https://identity.example.com/token',
    hooks: { onLoginStart, onLoginError },
  });
  return { client, onLoginStart, onLoginError };
}

function saveTransaction(client: ReturnType<typeof makeClient>['client'], createdAt = Date.now()) {
  client.transactions.save({ clientId: client.config.clientId, state: 'old-state', verifier: 'old-verifier', createdAt });
  client.transactions.saveReturnTo('/projects/42?tab=activity#notes');
}

function restoreCachedPage() {
  act(() => { realWindow.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
}

describe('LoginPage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    realWindow.history.replaceState(null, '', '/login');
    assign = vi.fn();
    navigationType = 'navigate';
    const location = new Proxy({}, {
      get(_target, property) { return property === 'assign' ? assign : Reflect.get(realWindow.location, property, realWindow.location); },
    });
    vi.stubGlobal('window', new Proxy(realWindow, {
      get(target, property) {
        const value: unknown = property === 'location' ? location : Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }));
    vi.stubGlobal('performance', new Proxy(realPerformance, {
      get(target, property) {
        if (property === 'getEntriesByType') return (type: string) => type === 'navigation' ? [{ type: navigationType }] : [];
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    realWindow.history.replaceState(null, '', '/');
  });

  it('shows a typed custom error when login start fails', async () => {
    const onLoginError = vi.fn(async () => undefined);
    const client = createAuthClient({
      clientId: `login-page-${crypto.randomUUID()}`,
      authorizationEndpoint: 'https://identity.example.com/authorize',
      tokenEndpoint: 'https://identity.example.com/token',
      hooks: {
        onLoginStart: async () => { throw new Error('authorization setup failed'); },
        onLoginError,
      },
    });
    function CustomView({ status, error }: LoginViewProps): ReactElement {
      return <main>{error?.message ?? status}</main>;
    }

    render(<LoginPage client={client} View={CustomView} />);

    await waitFor(() => expect(screen.getByText('authorization setup failed')).toBeInTheDocument());
    expect(onLoginError).toHaveBeenCalledWith({
      code: 'LOGIN_START_FAILED', message: 'authorization setup failed', stage: 'login',
    });
    expect(client.transactions.consume()).toBeNull();
  });

  it('cancels an unexpired login on document history restoration under Strict Mode', () => {
    navigationType = 'back_forward';
    const { client, onLoginStart, onLoginError } = makeClient();
    saveTransaction(client);
    render(<StrictMode><LoginPage client={client} /></StrictMode>);

    expect(screen.getByRole('status')).toHaveTextContent('Login was cancelled.');
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(client.transactions.read()).toBeNull();
    expect(client.transactions.consumeReturnTo()).toBe('/projects/42?tab=activity#notes');
    expect(onLoginStart).not.toHaveBeenCalled();
    expect(onLoginError).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('automatically starts a fresh direct login', async () => {
    const { client, onLoginStart } = makeClient();
    render(<StrictMode><LoginPage client={client} /></StrictMode>);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('Logging in…');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onLoginStart).toHaveBeenCalledTimes(1);
  });

  it.each(['navigate', 'reload'] as const)('starts login with an old transaction on %s navigation', async (type) => {
    navigationType = type;
    const { client } = makeClient();
    saveTransaction(client);
    render(<LoginPage client={client} />);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(client.transactions.read()?.state).not.toBe('old-state');
    expect(screen.getByRole('status')).toHaveTextContent('Logging in…');
  });

  it('starts protected-route login even if the document originally loaded by history traversal', async () => {
    navigationType = 'back_forward';
    realWindow.history.replaceState(null, '', '/projects');
    const { client } = makeClient();
    saveTransaction(client);
    render(<ReactAuthProvider client={client}><span>Protected page</span></ReactAuthProvider>);
    await act(async () => { await client.acquireToken(); });
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(client.transactions.read()?.state).not.toBe('old-state');
    expect(screen.getByRole('status')).toHaveTextContent('Logging in…');
  });

  it('does not cancel an expired transaction on history restoration', async () => {
    navigationType = 'back_forward';
    const { client } = makeClient();
    saveTransaction(client, Date.now() - 10 * 60 * 1000 - 1);
    render(<LoginPage client={client} />);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('Logging in…');
  });

  it('cancels cached attempts, retries with fresh PKCE, and cancels again after another Back', async () => {
    const { client, onLoginStart, onLoginError } = makeClient();
    client.transactions.saveReturnTo('/projects/42?tab=activity#notes');
    render(<LoginPage client={client} />);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const initialTransaction = client.transactions.read();

    restoreCachedPage();
    expect(screen.getByRole('status')).toHaveTextContent('Login was cancelled.');
    expect(client.transactions.read()).toBeNull();
    const button = screen.getByRole('button', { name: 'Log in' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
    const retryTransaction = client.transactions.read();
    expect(retryTransaction?.state).not.toBe(initialTransaction?.state);
    expect(retryTransaction?.verifier).not.toBe(initialTransaction?.verifier);
    const authorizationUrl = new URL(assign.mock.calls[1][0]);
    expect(authorizationUrl.searchParams.get('state')).toBe(retryTransaction?.state);
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(onLoginStart).toHaveBeenCalledTimes(2);

    restoreCachedPage();
    expect(screen.getByRole('status')).toHaveTextContent('Login was cancelled.');
    expect(assign).toHaveBeenCalledTimes(2);
    expect(onLoginError).not.toHaveBeenCalled();
    expect(client.transactions.consumeReturnTo()).toBe('/projects/42?tab=activity#notes');
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(3));
  });

  it('restarts an expired attempt after bfcache restoration', async () => {
    const { client } = makeClient();
    render(<LoginPage client={client} />);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    saveTransaction(client, Date.now() - 10 * 60 * 1000 - 1);
    restoreCachedPage();
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('Logging in…');
  });

  it('supplies an always-present retry action to a custom cancelled view', async () => {
    navigationType = 'back_forward';
    const { client } = makeClient();
    saveTransaction(client);
    const view = vi.fn(({ status, error, onRetry }: LoginViewProps) => <main>
      <p>{error?.message ?? status}</p><button type="button" onClick={onRetry}>Branded log in</button>
    </main>);
    render(<LoginPage client={client} View={view} />);
    expect(screen.getByText('cancelled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Branded log in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(screen.getByText('redirecting')).toBeInTheDocument();
    const props = view.mock.calls.map(([value]) => value);
    expect(props.every((value) => value.onRetry === props[0].onRetry)).toBe(true);
  });

  it('coalesces concurrent library retries after an already-settled initial login', async () => {
    const { client, onLoginStart } = makeClient();
    saveTransaction(client);
    await client.enterLoginStage();
    const original = client.transactions.read();
    const first = client.retryLogin();
    const second = client.retryLogin();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(assign).toHaveBeenCalledTimes(2);
    expect(onLoginStart).toHaveBeenCalledTimes(2);
    expect(client.transactions.read()?.state).not.toBe(original?.state);
    expect(client.transactions.consumeReturnTo()).toBe('/projects/42?tab=activity#notes');
  });

  it('reports a failed retry once and preserves the return path for another attempt', async () => {
    navigationType = 'back_forward';
    const { client, onLoginStart, onLoginError } = makeClient();
    saveTransaction(client);
    onLoginStart.mockRejectedValueOnce(new Error('Provider unavailable'));
    function RetryView({ status, error, onRetry }: LoginViewProps): ReactElement {
      return <main>
        <p role={error === null ? 'status' : 'alert'}>{error?.message ?? status}</p>
        <button type="button" onClick={onRetry}>Log in</button>
      </main>;
    }
    render(<LoginPage client={client} View={RetryView} />);
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable');
    expect(onLoginError).toHaveBeenCalledTimes(1);
    expect(client.transactions.read()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(client.transactions.consumeReturnTo()).toBe('/projects/42?tab=activity#notes');
  });

  it('ignores errors from a canceled pending attempt after a retry has started', async () => {
    const { client, onLoginStart, onLoginError } = makeClient();
    let rejectInitial: (reason: Error) => void = () => undefined;
    onLoginStart.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectInitial = reject; }));
    render(<LoginPage client={client} />);
    await waitFor(() => expect(onLoginStart).toHaveBeenCalledTimes(1));
    restoreCachedPage();
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const retryTransaction = client.transactions.read();
    await act(async () => { rejectInitial(new Error('Old attempt failed')); });
    expect(client.transactions.read()).toEqual(retryTransaction);
    expect(screen.getByRole('status')).toHaveTextContent('Logging in…');
    expect(onLoginError).not.toHaveBeenCalled();
  });
});
