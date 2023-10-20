import { OauthConfig } from '@/types';
import { describe, expect, test, vi } from 'vitest';
import { TokenStorage } from '../token-storage/TokenStorage';
import { OauthRequest } from './OauthRequest';

const config = new OauthConfig({
  clientId: '123',
  redirectUri: 'http://localhost:123',
  authEndpoint: 'http://authendpoint.com',
  tokenEndpoint: 'http://tokenendpoint.com'
})
const services = new OauthRequest({ storage: new TokenStorage({ clientId: '123' }), config })
describe('Oauth Request', () => {
  test('Should get code verifier', () => {
    const result = services.generateVerifier(43)
    expect(result.length).toBe(43)
    expect(typeof result).toEqual('string')
  });

  test('Should not generate the same code', () => {
    const set = new Set()
    for (let x = 0; x < 100; x++) {
      const verifier = services.generateVerifier(44)
      expect(set.has(verifier)).toBe(false)
      set.add(verifier)
    }
  });

  test('Should generate challenge', async () => {
    const verifier =
      '0_uEg2vKAREA-Ehl7yZ7X6L1imwMuZpVwqp8sHOBVKRTIU2ok1E2fyKRUUl-fEmJ1GhcgtoNZa27oBrcymNmfA'
    const expectedChallenge = 'VR0tn9iTtd8LPWmL-OcLETZyA0Ok9Ohi4Z5cywPVsWM'
    const challenge = await services.generateChallenge(verifier)
    expect(challenge).toEqual(expectedChallenge)
  });

  test('Should not match incorrect challenge', async () => {
    const verifier =
      '0_uEg2vKAREA-Ehl7yZ7X6L1imwMuZpVwqp8sHOBVKRTIU2ok1E2fyKRUUl-fEmJ1GhcgtoNZa27oBrcymNmfA'
    const badChallenge = 'VR0tn9iTtd8LPWmL-OcLETZyA0Ok9Ohi4Z5cywPVsWM1'
    const challenge = await services.generateChallenge(verifier)
    expect(challenge).not.toEqual(badChallenge)
  });

  test('Should generate redirect url', async () => {
    const redirectUrl = await services.generateAuthUrl()
    expect(redirectUrl.origin).toEqual(config.authEndpoint);
    expect(redirectUrl.searchParams.get('client_id')).toBe('123');
    expect(redirectUrl.searchParams.get('redirect_uri')).toBe(config.redirectUrl);
    expect(redirectUrl.searchParams.get('state')).toBe('/');
  })

  test('Should navigate to url', async () => {
    delete global.window.location
    global.window = Object.create(window)
    Object.defineProperty(window, 'location', {
      value: {
        assign: vi.fn(),
      },
    })

    delete global.window.sessionStorage
    global.window = Object.create(window)
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        setItem: vi.fn(),
      },
    })
    await services.login();
    expect(window.location.assign).toHaveBeenCalledTimes(1);
  })
});