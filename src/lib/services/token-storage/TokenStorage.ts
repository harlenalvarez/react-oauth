import type { StoredTokenRecord } from '@/types';

export class TokenStorage {
  readonly clientId: string;
  private readonly recordKey: string;
  private readonly verifierKey: string;
  private readonly challengeKey: string;

  constructor(args: { readonly clientId: string }) {
    this.clientId = args.clientId;
    const namespace = encodeURIComponent(this.clientId);
    this.recordKey = `react-oauth:tokens:${namespace}`;
    this.verifierKey = `react-oauth:pkce-verifier:${namespace}`;
    this.challengeKey = `react-oauth:pkce-challenge:${namespace}`;
  }

  save(record: StoredTokenRecord): void {
    localStorage.setItem(this.recordKey, JSON.stringify(record));
  }

  getRecord(): StoredTokenRecord | null {
    const raw = localStorage.getItem(this.recordKey);
    if (raw === null) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return isStoredTokenRecord(value) ? value : null;
    } catch {
      return null;
    }
  }

  clear(): void {
    localStorage.removeItem(this.recordKey);
  }

  set Verifier(value: string) {
    setOptionalStorageValue(this.verifierKey, value);
  }

  get Verifier(): string {
    return localStorage.getItem(this.verifierKey) ?? '';
  }

  set Challenge(value: string) {
    setOptionalStorageValue(this.challengeKey, value);
  }

  get Challenge(): string {
    return localStorage.getItem(this.challengeKey) ?? '';
  }

  async setAccessToken(value: string): Promise<void> {
    this.updateRecord({ accessToken: value });
  }

  async getAccessToken(): Promise<string> {
    return this.getRecord()?.accessToken ?? '';
  }

  async setRefreshToken(value: string): Promise<void> {
    this.updateRecord({ refreshToken: value });
  }

  async getRefreshToken(): Promise<string> {
    return this.getRecord()?.refreshToken ?? '';
  }

  async setIdToken(value: string): Promise<void> {
    this.updateRecord({ idToken: value });
  }

  async getIdToken(): Promise<string> {
    return this.getRecord()?.idToken ?? '';
  }

  set TokenExpiration(value: number) {
    const current = this.getRecord();
    if (current !== null) this.save({ ...current, expiresAt: value });
  }

  get TokenExpiration(): number {
    return this.getRecord()?.expiresAt ?? 0;
  }

  set GenCode(_value: string) {
    // Kept as a compatibility setter; authorization codes are never persisted.
  }

  get GenCode(): string {
    return '';
  }

  private updateRecord(update: Partial<StoredTokenRecord>): void {
    const current = this.getRecord();
    if (current === null) {
      if (update.accessToken === undefined || update.accessToken === '') return;
      this.save({ accessToken: update.accessToken, tokenType: 'Bearer', expiresAt: 0 });
      return;
    }
    const next = { ...current, ...update };
    if (update.accessToken === '') {
      this.clear();
      return;
    }
    this.save(next);
  }
}

function setOptionalStorageValue(key: string, value: string): void {
  if (value.length === 0) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

function isStoredTokenRecord(value: unknown): value is StoredTokenRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.accessToken === 'string' && record.accessToken.length > 0 &&
    typeof record.tokenType === 'string' && record.tokenType.toLowerCase() === 'bearer' &&
    typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt) &&
    (record.refreshToken === undefined || typeof record.refreshToken === 'string') &&
    (record.idToken === undefined || typeof record.idToken === 'string') &&
    (record.grantedScopes === undefined || (Array.isArray(record.grantedScopes) && record.grantedScopes.every((scope: unknown) => typeof scope === 'string')));
}

const storageMap = new Map<string, TokenStorage>();

export function getTokenStorage(clientId: string): TokenStorage {
  const existing = storageMap.get(clientId);
  if (existing !== undefined) return existing;
  const storage = new TokenStorage({ clientId });
  storageMap.set(clientId, storage);
  return storage;
}
