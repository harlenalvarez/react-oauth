import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getTokenStorage } from './TokenStorage';

const mockStorage = (returnValue: string) => {
  const { setItem, getItem, removeItem } = Storage.prototype
  Storage.prototype.setItem = vi.spyOn(Storage.prototype, 'setItem') as any;
  Storage.prototype.getItem = vi.spyOn(Storage.prototype, 'getItem') as any;
  Storage.prototype.removeItem = vi.spyOn(Storage.prototype, 'removeItem') as any;

  return () => {
    Storage.prototype.setItem = setItem;
    Storage.prototype.getItem = getItem;
    Storage.prototype.removeItem = removeItem;
  }
}

describe('Token Storage', () => {
  beforeAll(() => {
    vi.stubGlobal('isSecureContext', true);
  });

  it('Should create an instance per client id', () => {
    const client = getTokenStorage('123');
    const sameClient = getTokenStorage('123');
    const difClient = getTokenStorage('234');

    expect(client).toBe(sameClient);
    expect(client).not.toBe(difClient);
  });

  it('Should encryp values', async () => {
    const sample = 'value to be encoded';
    const client = getTokenStorage('123');
    const result = await client.Encrypt(sample);
    expect(result).toContain(`ÁyNñ%C\u009c\u0095`);
  });

  it('Should decrupt values', async () => {
    const sample = 'value 1';
    const client = getTokenStorage('123');
    const result = await client.Encrypt(sample);
    const decrypted = await client.Decrypt(result);
    expect(decrypted).toBe('value 1');
  });

  it('Should set and get Verifier', () => {
    const verifier = 'test_verifier';
    const resetStorage = mockStorage(verifier);

    const tokenStorage = getTokenStorage('123');
    tokenStorage.Verifier = verifier;
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).toHaveBeenCalledWith('PKCE_Verifier', verifier);
    const result = tokenStorage.Verifier;
    expect(result).toBe(verifier);

    //Check that it removes it
    tokenStorage.Verifier = '';
    expect(localStorage.removeItem).toHaveBeenCalledTimes(1);
    resetStorage();
  });

  it('Should set and get challenge', () => {
    const challenge = 'test_challenge';
    const resetStorage = mockStorage(challenge);
    expect(localStorage.setItem).toHaveBeenCalledTimes(0);
    const service = getTokenStorage('123');
    service.Challenge = challenge;
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).toHaveBeenCalledWith('PKCE_Challenge', challenge);

    const savedChallenge = service.Challenge;
    expect(savedChallenge).toBe(challenge);
    service.Challenge = '';
    expect(localStorage.removeItem).toHaveBeenCalledTimes(1);
    resetStorage();
  });

  it('Should get set access token', async () => {
    const accessToken = 'access_token';
    const services = getTokenStorage('123');
    const encryptedToken = await services.Encrypt(accessToken);
    const resetStorage = mockStorage(encryptedToken);

    await services.setAccessToken(accessToken);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).toHaveBeenCalledWith('AccessToken_123', encryptedToken);
    const savedToken = await services.getAccessToken();
    expect(savedToken).toBe(accessToken);
    await services.setAccessToken('');
    expect(localStorage.removeItem).toHaveBeenCalledTimes(1);
    resetStorage();
  });

  it('Should get set refresh token', async () => {
    const refreshToken = 'refesh_token';
    const services = getTokenStorage('123');
    const encryptedToken = await services.Encrypt(refreshToken);
    const reset = mockStorage(encryptedToken);
    await services.setRefreshToken(refreshToken);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).toHaveBeenCalledWith('RefreshToken_123', encryptedToken);
    const saved = await services.getRefreshToken();
    expect(saved).toBe(refreshToken)
    await services.setRefreshToken('')
    expect(localStorage.removeItem).toHaveBeenCalledTimes(1)
    expect(localStorage.removeItem).toHaveBeenCalledWith('RefreshToken_123')
    reset();
  });

  it('Should get set idToken', async () => {
    const idToken = 'id_token';
    const services = getTokenStorage('123');
    const encryptedToken = await services.Encrypt(idToken)
    const reset = mockStorage(encryptedToken);
    await services.setIdToken(idToken);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(localStorage.setItem).toHaveBeenCalledWith('IdToken_123', encryptedToken);
    const saved = await services.getIdToken();
    expect(saved).toBe(idToken);
    await services.setIdToken('');
    expect(localStorage.removeItem).toHaveBeenCalledTimes(1);
    expect(localStorage.removeItem).toHaveBeenCalledWith('IdToken_123');
    reset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });
})