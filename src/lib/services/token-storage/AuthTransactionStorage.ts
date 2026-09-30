import type { AuthTransaction } from '@/types';

const transactionLifetimeMs = 10 * 60 * 1000;

export class AuthTransactionStorage {
  private readonly transactionKey: string;
  private readonly returnToKey: string;

  constructor(clientId: string) {
    const namespace = encodeURIComponent(clientId);
    this.transactionKey = `react-oauth:transaction:${namespace}`;
    this.returnToKey = `react-oauth:return-to:${namespace}`;
  }

  save(transaction: AuthTransaction): void {
    sessionStorage.setItem(this.transactionKey, JSON.stringify(transaction));
  }

  consume(): AuthTransaction | null {
    const raw = sessionStorage.getItem(this.transactionKey);
    sessionStorage.removeItem(this.transactionKey);
    if (raw === null) return null;

    try {
      const value: unknown = JSON.parse(raw);
      if (!isAuthTransaction(value) || Date.now() - value.createdAt > transactionLifetimeMs) return null;
      return value;
    } catch {
      return null;
    }
  }

  saveReturnTo(path: string): void {
    sessionStorage.setItem(this.returnToKey, path);
  }

  consumeReturnTo(): string | null {
    const path = sessionStorage.getItem(this.returnToKey);
    sessionStorage.removeItem(this.returnToKey);
    return path;
  }

  clear(): void {
    sessionStorage.removeItem(this.transactionKey);
    sessionStorage.removeItem(this.returnToKey);
  }
}

function isAuthTransaction(value: unknown): value is AuthTransaction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.clientId === 'string' && typeof record.state === 'string' &&
    typeof record.verifier === 'string' && typeof record.createdAt === 'number' &&
    (record.nonce === undefined || typeof record.nonce === 'string');
}
