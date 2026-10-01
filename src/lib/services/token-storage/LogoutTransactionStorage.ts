import type { AuthError } from '@/types';

export type LogoutTransaction =
  | { readonly status: 'pending'; readonly callbackUri: string; readonly state: string; readonly createdAt: number }
  | { readonly status: 'complete'; readonly callbackUri: string }
  | { readonly status: 'error'; readonly callbackUri: string; readonly error: AuthError };

export const logoutTransactionLifetimeMs = 10 * 60 * 1000;

// Never store the ID-token hint here. Only the request URL carries it to the provider.
export class LogoutTransactionStorage {
  private readonly key: string;

  constructor(clientId: string) {
    this.key = `react-oauth:logout:${encodeURIComponent(clientId)}`;
  }

  get(): LogoutTransaction | null {
    const raw = sessionStorage.getItem(this.key);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!isLogoutTransaction(value)) throw new Error('The logout transaction is malformed.');
    return value;
  }

  save(transaction: LogoutTransaction): void {
    sessionStorage.setItem(this.key, JSON.stringify(transaction));
  }

  clear(): void {
    sessionStorage.removeItem(this.key);
  }
}

function isLogoutTransaction(value: unknown): value is LogoutTransaction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.callbackUri !== 'string') return false;
  if (record.status === 'complete') return true;
  if (record.status === 'pending') {
    return typeof record.state === 'string' && record.state.length > 0 &&
      typeof record.createdAt === 'number' && Number.isFinite(record.createdAt);
  }
  if (record.status !== 'error' || typeof record.error !== 'object' || record.error === null) return false;
  const error = record.error as Record<string, unknown>;
  return typeof error.code === 'string' && typeof error.message === 'string';
}
