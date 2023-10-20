import { AUTH_ERRORS, OAuthError, OauthConfig, OauthResponseCodes, RedirectResponse, TokenError, TokenResponse } from '@/types'
import { isType } from '@practicaljs/ts-kit'
import { TokenStorgeType } from '../token-storage'
import { TokenStorage } from '../token-storage/TokenStorage'

export class OauthResponse {
  private storage: TokenStorgeType
  private config: OauthConfig
  constructor({ storage, config }: { storage: TokenStorgeType, config: OauthConfig }) {
    this.storage = storage;
    this.config = config;

    this.handleOauthRedirectResponse = this.handleOauthRedirectResponse.bind(this);
    this.handleError = this.handleError.bind(this);
    this.getAccessToken = this.getAccessToken.bind(this);
  }

  handleOauthRedirectResponse(): RedirectResponse | OAuthError {
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.has(OauthResponseCodes.error)) {
      return this.handleError(searchParams)
    }

    const code = searchParams.get(OauthResponseCodes.code)
    if (!code)
      return {
        errorCode: AUTH_ERRORS.missingCode,
        errorDetails: 'Query code not found',
      }

    const verifier = this.storage.Verifier
    if (!verifier)
      return {
        errorCode: AUTH_ERRORS.missingVerifier,
        errorDetails: 'Code verifier not found',
      }
    const originPath = searchParams.get(OauthResponseCodes.state) ?? '/'
    return { code, originPath }
  }

  handleError(searchParams: URLSearchParams): OAuthError {
    const code = searchParams.get(OauthResponseCodes.error) ?? 'Unknown'
    const details = searchParams.has(OauthResponseCodes.errorDescription)
      ? searchParams.get(OauthResponseCodes.errorDescription)!
      : 'Unknown'
    return { errorCode: code, errorDetails: details }
  }

  async getAccessToken(code: string): Promise<TokenResponse | OAuthError> {
    if (!code) {
      return {
        errorCode: AUTH_ERRORS.missingCode,
        errorDetails: 'Missing code while getting access token'
      }
    }

    if (!this.storage.Verifier) {
      return {
        errorCode: AUTH_ERRORS.missingVerifier,
        errorDetails: 'Missing verifier while getting access token'
      }
    }

    const form = new FormData();
    form.append('client_id', this.config.clientId);
    form.append('code_verifier', this.storage.Verifier);
    form.append('code', code);
    form.append('redirect_uri', this.config.redirectUrl);

    try {
      const response = await fetch(this.config.tokenEndpoint, {
        method: 'POST',
        body: form
      });

      const data = await response.json() as TokenResponse | TokenError;
      if (isType(data, 'error')) {
        console.error(data);
        return {
          errorCode: AUTH_ERRORS.fetchAccessToken,
          errorDetails: data.error_description || 'Failed to fetch access token'
        }
      }

      this.storage.Verifier = '';
      this.storage.Challenge = '';
      this.storage.GenCode = code;

      await Promise.allSettled([
        this.storage.setAccessToken(data.access_token),
        this.storage.setRefreshToken(data.refresh_token)
      ])
      return data;
    }
    catch (err) {
      console.error(err);
      return {
        errorCode: AUTH_ERRORS.fetchAccessToken,
        errorDetails: 'Unknown network error while fetching access token'
      }
    }
  }

  async renewAccessToken(): Promise<OAuthError | null> {
    const refresh = await this.storage.getRefreshToken();
    if (!refresh) {
      return {
        errorCode: AUTH_ERRORS.missingRefreshToken,
        errorDetails: 'Failed to renew token'
      }
    }

    const form = new FormData();
    form.append('grant_type', 'refresh_token');
    form.append('refresh_token', refresh);
    try {
      const response = await fetch(this.config.tokenEndpoint, {
        method: 'POST',
        body: form
      });
      const data = await response.json() as TokenResponse | TokenError;
      if (isType(data, 'error')) {
        console.log(data);
        return {
          errorCode: AUTH_ERRORS.fetchAccessToken,
          errorDetails: 'Failed to renew token'
        }
      }

      await this.storage.setAccessToken(data.access_token);
      if (data.refresh_token) {
        await this.storage.setRefreshToken(data.refresh_token)
      }
    }
    catch (err) { }

    return null;
  }
}

export type OauthResponseService = OauthResponse

const responseMap = new Map<string, OauthResponse>()
export const getOauthResponseService = (config: OauthConfig): OauthResponseService => {
  const client = responseMap.get(config.clientId)
  if (client) return client;

  const token = new TokenStorage({ clientId: config.clientId });
  const responseService = new OauthResponse({ storage: token, config })
  return responseService;
}