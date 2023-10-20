import { genKey } from "@/utils";

export class TokenStorage {

  private verifierKey = 'PKCE_Verifier';
  private challengeKey = 'PKCE_Challenge';
  private accessTokenKey: string;
  private refreshTokenKey: string;
  private idTokenKey: string;
  private tokenExpKey: string;
  private clientId: string;
  private encoder: TextEncoder;
  private decoder: TextDecoder;
  private iv: Uint8Array;
  private genKey: string;

  constructor(args: { clientId: string }) {
    this.clientId = args.clientId;
    this.accessTokenKey = `AccessToken_${this.clientId}`;
    this.refreshTokenKey = `RefreshToken_${this.clientId}`;
    this.idTokenKey = `IdToken_${this.clientId}`;
    this.tokenExpKey = `Exptoken_${this.clientId}`;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    this.iv = Uint8Array.from(this.accessTokenKey, x => x.charCodeAt(0));
    this.genKey = `CODE_${this.clientId}`;
  }

  set Verifier(value: string) {
    if (!value) {
      localStorage.removeItem(this.verifierKey);
      return;
    }
    localStorage.setItem(this.verifierKey, value);
  }

  get Verifier() {
    return localStorage.getItem(this.verifierKey) || '';
  }

  set Challenge(value: string) {
    if (!value) {
      localStorage.removeItem(this.challengeKey);
      return;
    }
    localStorage.setItem(this.challengeKey, value);
  }

  get Challenge() {
    return localStorage.getItem(this.challengeKey) || '';
  }

  set TokenExpiration(value: number) {
    localStorage.setItem(this.tokenExpKey, `${value || 0}`);
  }

  get TokenExpiration() {
    return Number(localStorage.getItem(this.tokenExpKey) || 0);
  }

  set GenCode(value: string) {
    if (!value) {
      localStorage.removeItem(this.genKey);
      return;
    }
    localStorage.setItem(this.genKey, value);
  }

  get GenCode() {
    return localStorage.getItem(this.genKey) || '';
  }

  async setAccessToken(value: string) {
    await this.setTokenByKey(this.accessTokenKey, value)
  }

  async getAccessToken() {
    return await this.getTokenByKey(this.accessTokenKey)
  }

  async Encrypt(value: string) {
    if (!isSecureContext) return value;
    const encoded = this.encoder.encode(value);
    const key = await genKey(this.GenCode);
    const encryptedValue = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: this.iv }, key, encoded);
    const encryptedString = String.fromCharCode(...new Uint8Array(encryptedValue));
    return encryptedString
  }

  async Decrypt(value: string) {
    if (!isSecureContext) return value;
    const encoded = Uint8Array.from(value, x => x.charCodeAt(0));
    const key = await genKey(this.GenCode);
    const decryptedValue = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.iv }, key, encoded);
    return this.decoder.decode(decryptedValue);
  }

  async setRefreshToken(value: string) {
    await this.setTokenByKey(this.refreshTokenKey, value)
  }

  async getRefreshToken() {
    return await this.getTokenByKey(this.refreshTokenKey)
  }

  async setIdToken(value: string) {
    await this.setTokenByKey(this.idTokenKey, value);
  }
  async getIdToken() {
    return await this.getTokenByKey(this.idTokenKey);
  }

  async setTokenByKey(key: string, value: string) {
    if (!value) {
      localStorage.removeItem(key);
      return;
    }
    const encrypted = await this.Encrypt(value);
    localStorage.setItem(key, encrypted);
  }

  async getTokenByKey(key: string) {
    const savedToken = localStorage.getItem(key) || '';
    if (!savedToken) return savedToken;

    const decrypted = await this.Decrypt(savedToken);
    return decrypted;
  }
}

const storageMap = new Map<string, TokenStorage>()

// Only want to export the type not the actual class to prevent newing this service directly
export type TokenStorgeType = TokenStorage
export const getTokenStorage = (clientId: string): TokenStorgeType => {
  const client = storageMap.get(clientId)
  if (client) return client;

  const storage = new TokenStorage({ clientId });
  storageMap.set(clientId, storage);
  return storage;
}

