import { genKey } from "@/utils";

class TokenStorage {

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

  constructor(args: { clientId: string }) {
    this.clientId = args.clientId;
    this.accessTokenKey = `AccessToken_${this.clientId}`;
    this.refreshTokenKey = `RefreshToken_${this.clientId}`;
    this.idTokenKey = `IdToken_${this.clientId}`;
    this.tokenExpKey = `Exptoken_${this.clientId}`;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    this.iv = Uint8Array.from(this.accessTokenKey, x => x.charCodeAt(0));
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

  async setAccessToken(value: string) {
    if(!value) {
      localStorage.removeItem(this.accessTokenKey);
      return;
    }
    const ecryptedToken = await this.Encrypt(value);
    localStorage.setItem(this.accessTokenKey, ecryptedToken);
  }

  async getAccessToken() {
    const savedToken = localStorage.getItem(this.accessTokenKey) || '';
    if(!savedToken) return savedToken;

    const decrypted = await this.Decrypt(savedToken);
    return decrypted;
  }

  async Encrypt(value: string) {
    if (!isSecureContext) return value;
    const encoded = this.encoder.encode(value);
    const key = await genKey(); 
    const encryptedValue = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: this.iv }, key, encoded);
    const encryptedString = String.fromCharCode(...new Uint8Array(encryptedValue));
    return encryptedString
  }

  async Decrypt(value: string) {
    if (!isSecureContext) return value;
    const encoded = Uint8Array.from(value, x => x.charCodeAt(0));
    const key = await genKey();
    const decryptedValue = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.iv }, key, encoded);
    return this.decoder.decode(decryptedValue);
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

