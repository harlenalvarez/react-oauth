import { AUTH_ERRORS, OAuthError, OauthConfig, RedirectResponse, TokenError, TokenResponse } from '@/types';
import { isType } from '@practicaljs/ts-kit';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TokenStorage } from '../token-storage/TokenStorage';
import { OauthResponse } from './OauthResponse';

const ogfetch = global.fetch
const config = new OauthConfig({
  clientId: '123',
  redirectUri: 'http://localhost:123',
  authEndpoint: 'http://authendpoint.com',
  tokenEndpoint: 'http://tokenendpoint.com'
})
const tokenService = new TokenStorage({ clientId: config.clientId })
const service = new OauthResponse({ storage: tokenService, config })
describe('Oauth Response Handler', () => {
  beforeEach(() => {
    delete global.window.location
    global.window = Object.create(window)
    global.console = Object.create(console)
    global.console.error = vi.fn()
    global.isSecureContext = true;
  })

  test('Should show response code and details', () => {
    // arrange
    const returnedUrl = new URL(
      'http://test.com/oauth-callback?error=1&error_description=failed'
    )
    // act
    const result = service.handleError(returnedUrl.searchParams)
    // assert
    expect(result).toEqual({ errorCode: '1', errorDetails: 'failed' })
  })

  test('Should show response code and unknows if no details', () => {
    // arrange
    const returnedUrl = new URL('http://test.com/oauth-callback?error=1')
    // act
    const result = service.handleError(returnedUrl.searchParams)
    // assert
    expect(result).toEqual({ errorCode: '1', errorDetails: 'Unknown' })
  })

  test('Should return error from href', () => {
    // arrange
    const returnedUrl = new URL(
      'http://test.com/oauth-callback?error=1&error_description=failed'
    )
    global.window.location = Object.assign(returnedUrl)
    // act
    const result = service.handleOauthRedirectResponse()
    // assert
    // should be auth error
    expect(isType<OAuthError>(result, 'errorCode')).toBe(true)
    // should not be response
    expect(isType<RedirectResponse>(result, 'code', 'originPath')).toBe(false)
    expect(result).toEqual({ errorCode: '1', errorDetails: 'failed' })
  })

  test('Should return error if code not found', () => {
    // arrange
    const returnedUrl = new URL('http://test.com/oauth-callback?success=1&state=%25')
    global.window.location = Object.assign(returnedUrl)
    // act
    const result = service.handleOauthRedirectResponse()
    // assert
    expect(result).toEqual({
      errorCode: AUTH_ERRORS.missingCode,
      errorDetails: 'Query code not found',
    })
  })

  test('Should return error if verifier not found', () => {
    const returnedUrl = new URL(
      'http://test.com/oauth-callback?success=1&code=testcode&state=%25'
    )
    global.window.location = Object.assign(returnedUrl)

    const result = service.handleOauthRedirectResponse()
    expect(result).toEqual({
      errorCode: AUTH_ERRORS.missingVerifier,
      errorDetails: 'Code verifier not found',
    })
  })

  test('Should return code and verifier', () => {
    const returnedUrl = new URL(
      'http://test.com/oauth-callback?success=1&code=testcode&state=%2F'
    )
    global.window.location = Object.assign(returnedUrl)
    localStorage.setItem('PKCE_Verifier', 'testVerifier')

    const result = service.handleOauthRedirectResponse()
    expect(result).toEqual({
      code: 'testcode',
      originPath: '/',
    })
  })

  test('Should fetch access token', async () => {
    // arrange
    localStorage.setItem('PKCE_Verifier', 'testVerifier')
    const code = 'testCode'

    // response payload
    const expectedResponse: TokenResponse = {
      id_token: 'test_id',
      access_token: 'test_access_token',
      refresh_token: 'test_refresh_token',
      scope: 'test_scope',
      token_type: 'bearer',
      expires_in: '1234'
    }

    let passedForm: FormData
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    global.fetch = vi.fn(async (url, prop) => {
      passedForm = prop!.body as FormData
      return {
        json: async () => expectedResponse,
      }
    })

    // act
    const tokenReponse = await service.getAccessToken(code)

    // assert
    expect(global.fetch).toHaveBeenCalledWith(
      'http://tokenendpoint.com',
      {
        method: 'POST',
        body: expect.any(FormData)
      }
    )

    // assert each form data
    expect(passedForm!.get('client_id')).toEqual('123')
    expect(passedForm!.get('code_verifier')).toEqual('testVerifier')
    expect(passedForm!.get('code')).toEqual(code)
    expect(passedForm!.get('redirect_uri')).toEqual('http://localhost:123/oauth-response')

    expect(tokenReponse).toEqual(expectedResponse)
    expect(tokenService.Verifier).toBe('');
    expect(tokenService.Challenge).toBe('');
  })

  test('Should Return error on failure', async () => {
    tokenService.Verifier = 'testVerifier';
    const code = Array(33).fill('1').join('');

    // response payload
    const expectedResponse: TokenError = {
      error: 'Failed to fetch token',
      error_codes: ['12'],
      error_description: 'Failed to fetch token detail',
      timestamp: 'now',
      trace_id: 'trace id',
      correlation_id: 'correlation id'
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    global.fetch = vi.fn(async (url, prop) => {
      return {
        json: async () => expectedResponse,
      }
    })

    // act
    const tokenReponse = await service.getAccessToken(code)

    // assert
    expect(tokenReponse).toEqual({
      errorCode: AUTH_ERRORS.fetchAccessToken,
      errorDetails: expectedResponse.error_description,
    })
  })

  test('Should Return error on network failure', async () => {
    tokenService.Verifier = 'testVerifier';
    const code = Array(33).fill('1').join('');
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    global.fetch = vi.fn(async (url, prop) => {
      return {
        json: async () => {
          throw new Error('Network error')
        },
      }
    })

    // act
    const tokenReponse = await service.getAccessToken(code)

    expect(tokenReponse).toEqual({
      errorCode: AUTH_ERRORS.fetchAccessToken,
      errorDetails: expect.stringContaining('Unknown network error')
    })
  })

  test('Should fail to renew if refresh token is missing', async () => {
    tokenService.setRefreshToken('');
    const response = await service.renewAccessToken()
    expect(response).toEqual({
      errorCode: AUTH_ERRORS.missingRefreshToken,
      errorDetails: expect.stringContaining('')
    })
  })

  test('Should renew access token', async () => {
    await tokenService.setRefreshToken('test_refresh_token')
    // response payload
    const expectedResponse: TokenResponse = {
      access_token: 'test_access_token',
      id_token: 'id_token',
      refresh_token: 'test_refresh_token',
      expires_in: '123',
      scope: 'test_scope',
      token_type: 'bearer',
    }

    let passedForm: FormData
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    global.fetch = vi.fn(async (url, prop) => {
      passedForm = prop!.body as FormData
      return {
        json: async () => expectedResponse,
      }
    })

    const result = await service.renewAccessToken();
    expect(result).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      'http://tokenendpoint.com',
      {
        method: 'POST',
        body: expect.any(FormData)
      }
    )

    expect(passedForm!.get('grant_type')).toBe('refresh_token')
    expect(passedForm!.get('refresh_token')).toBe('test_refresh_token')

    const accessToken = await tokenService.getAccessToken();
    expect(accessToken).toBe('test_access_token');
  })

  afterEach(() => {
    global.fetch = ogfetch
  })
});