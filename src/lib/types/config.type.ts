import { create, isRequired } from "@/utils";

export type OauthConfigProps = Omit<OauthConfig, 'redirectUrl' | 'scopes'> & { redirectUri?:string, scopes?: string[] }

export class OauthConfig {
    clientId: string;
    authEndpoint: string;
    tokenEndpoint: string;
    scopes?: string;
    
    private redirectUri?: string;
    get redirectUrl() {
        const url = new URL(this.redirectUri || '')
        url.pathname = '/oauth-response'
        return url.href
    }

    constructor(obj?: OauthConfigProps) {
        this.clientId = obj?.clientId || '';
        this.authEndpoint = obj?.authEndpoint || '';
        this.tokenEndpoint = obj?.tokenEndpoint || '';
        this.redirectUri = obj?.redirectUri || window.location.origin;
        if(obj?.scopes) {
            this.scopes = obj.scopes.join(' ');
        }
    }
}

export type SetupConfig = (config: OauthConfigProps) => void;


export const createConfig = (setup: SetupConfig) => {
    const empty = new OauthConfig();
    setup(empty as any);
    empty.clientId || isRequired('clientId');
    empty.authEndpoint || isRequired('authEndpoint');
    empty.tokenEndpoint || isRequired('tokenEndpoint');
    return create(empty);
}