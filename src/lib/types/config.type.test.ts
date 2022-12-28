import { describe, it, vi } from 'vitest';
import { createConfig, OauthConfig, SetupConfig } from './config.type';

export const mockTestSetup: SetupConfig = (config) => {
    config.clientId = 'testClientId',
    config.authEndpoint = 'http://authEndpoint.com',
    config.tokenEndpoint = 'http://redirectUri.com',
    config.scopes = ['user']
}


describe('Config', () => {
    it('Should set values', () => {
        const mock = {
            origin: 'https://test.com'
        }
        vi.stubGlobal('location', mock);
        const config = new OauthConfig({ clientId: 'clientId', authEndpoint: 'endpoint', tokenEndpoint: 'endpoint', scopes: ['read']});
        expect(config).toMatchObject({clientId: 'clientId', authEndpoint: 'endpoint', tokenEndpoint: 'endpoint', redirectUri: mock.origin, scopes: 'read' });
        expect(config.redirectUrl).toBe('https://test.com/oauth-response')
        vi.unstubAllGlobals();
    });

    it('Should create config extension', () => {
        const mock = {
            origin: 'https://test.com'
        }
        vi.stubGlobal('location', mock);
        const func: SetupConfig = (config) => {
            config.clientId = 'oauth',
            config.authEndpoint = 'oauthEndpoint',
            config.tokenEndpoint = 'tokenEndpoint'
        }

        const config = createConfig(func);
        expect(config).toBeInstanceOf(OauthConfig);
        expect(config).toMatchObject({clientId: 'oauth', authEndpoint: 'oauthEndpoint', tokenEndpoint: 'tokenEndpoint', redirectUri: mock.origin, scopes: undefined });
        vi.unstubAllGlobals();
    })
});