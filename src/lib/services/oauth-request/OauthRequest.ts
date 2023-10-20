import { OauthConfig } from '@/types';
import { TokenStorgeType, getTokenStorage } from '../token-storage';

export class OauthRequest {
  private storage: TokenStorgeType
  private config: OauthConfig
  constructor({ storage, config }: { storage: TokenStorgeType, config: OauthConfig }) {
    this.storage = storage;
    this.config = config
    this.extractLast2HexFromDec = this.extractLast2HexFromDec.bind(this);
    this.generateVerifier = this.generateVerifier.bind(this);
    this.generateChallenge = this.generateChallenge.bind(this);
    this.generateAuthUrl = this.generateAuthUrl.bind(this);
    this.login = this.login.bind(this);
  }

  private extractLast2HexFromDec(dec: number): string {
    const hexString = dec.toString(16)
    const hexLength = hexString.length
    return hexString.substring(hexLength - 1)
  }

  generateVerifier(length = 43) {
    if (length < 43 || length > 128)
      throw new Error('Code verifier must be between 43 and 128 chars')
    const rndArray = crypto.getRandomValues(new Uint8Array(length));
    const codeVerifier = Array.from(rndArray, this.extractLast2HexFromDec).join('');
    return codeVerifier;
  }

  async generateChallenge(codeVerifier: string): Promise<string> {
    const encodedVerifier = new TextEncoder().encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', encodedVerifier);
    const digestString = String.fromCharCode(...new Uint8Array(digest));
    const challenge = btoa(digestString)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    return challenge;
  }

  async generateAuthUrl() {
    const verifier = this.generateVerifier();
    const challenge = await this.generateChallenge(verifier);
    this.storage.Verifier = verifier;
    this.storage.Challenge = challenge;

    const authUrl = new URL(this.config.authEndpoint)
    authUrl.searchParams.append('client_id', this.config.clientId);
    authUrl.searchParams.append('redirect_uri', this.config.redirectUrl);

    authUrl.searchParams.append('code_challenge', challenge);
    const search = new URLSearchParams(window.location.search);
    const originPath = search.has('originPath') ? search.get('originPath')! : '/';
    authUrl.searchParams.append('state', originPath)

    return authUrl
  }

  async login() {
    const redirectUrl = await this.generateAuthUrl()
    window.location.assign(redirectUrl.href)
  }
}

const requestMap = new Map<string, OauthRequest>()

// Only want to export the type not the actual class to prevent newing this service directly
export type OauthRequesService = OauthRequest
export const getOathRequestService = (config: OauthConfig): OauthRequest => {
  const client = requestMap.get(config.clientId)
  if (client) return client;

  const storage = getTokenStorage(config.clientId);
  const requestService = new OauthRequest({ storage, config });
  requestMap.set(config.clientId, requestService);
  return requestService;
}