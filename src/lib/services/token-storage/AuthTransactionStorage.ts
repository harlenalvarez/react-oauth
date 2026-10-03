import type { AuthError, AuthTransaction, LoginResult } from '@/types';

type LoginOutcome = { readonly path: string } & (
  | LoginResult
  | { readonly status: 'error'; readonly error: AuthError }
);

const transactionLifetimeMs = 10 * 60 * 1000;

export class AuthTransactionStorage {
  private readonly transactionKey: string;
  private readonly returnToKey: string;
  private readonly outcomeKey: string;

  constructor(clientId: string) {
    const namespace = encodeURIComponent(clientId);
    this.transactionKey = `react-oauth:transaction:${namespace}`;
    this.returnToKey = `react-oauth:return-to:${namespace}`;
    this.outcomeKey = `react-oauth:login-outcome:${namespace}`;
  }

  save(transaction: AuthTransaction): void {
    sessionStorage.setItem(this.transactionKey, JSON.stringify(transaction));
  }

  read(): AuthTransaction | null {
    const raw = sessionStorage.getItem(this.transactionKey);
    if (raw === null) return null;

    try {
      const value: unknown = JSON.parse(raw);
      if (!isAuthTransaction(value)) return null;
      const age = Date.now() - value.createdAt;
      if (age < 0 || age > transactionLifetimeMs) return null;
      return value;
    } catch {
      return null;
    }
  }

  consume(): AuthTransaction | null {
    const transaction = this.read();
    this.clearTransaction();
    return transaction;
  }

  clearTransaction(): void {
    sessionStorage.removeItem(this.transactionKey);
  }

  saveReturnTo(path: string): void {
    sessionStorage.setItem(this.returnToKey, path);
  }

  readReturnTo(): string | null {
    return sessionStorage.getItem(this.returnToKey);
  }

  saveOutcome(path: string, result: LoginResult | { readonly status: 'error'; readonly error: AuthError }): void {
    sessionStorage.setItem(this.outcomeKey, JSON.stringify({ ...result, path }));
  }

  readOutcome(path: string): LoginOutcome | null {
    const raw = sessionStorage.getItem(this.outcomeKey);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || !('path' in value) || value.path !== path || !('status' in value)) return null;
    if (value.status === 'cancelled') return { path, status: 'cancelled' };
    if (value.status === 'complete' && 'returnTo' in value && typeof value.returnTo === 'string') {
      return { path, status: 'complete', returnTo: value.returnTo };
    }
    if (value.status === 'error' && 'error' in value && typeof value.error === 'object' && value.error !== null &&
      'code' in value.error && typeof value.error.code === 'string' &&
      'message' in value.error && typeof value.error.message === 'string') {
      return { path, status: 'error', error: { code: value.error.code, message: value.error.message } };
    }
    return null;
  }

  clearOutcome(): void {
    sessionStorage.removeItem(this.outcomeKey);
  }

  consumeReturnTo(): string | null {
    const path = sessionStorage.getItem(this.returnToKey);
    sessionStorage.removeItem(this.returnToKey);
    return path;
  }

  clear(): void {
    this.clearTransaction();
    this.clearOutcome();
    sessionStorage.removeItem(this.returnToKey);
  }
}

function isAuthTransaction(value: unknown): value is AuthTransaction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.clientId === 'string' && typeof record.state === 'string' &&
    typeof record.verifier === 'string' && typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) &&
    (record.nonce === undefined || typeof record.nonce === 'string');
}
