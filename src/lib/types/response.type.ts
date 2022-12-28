export enum OauthResponse {
    error = 'error',
    code = 'code',
    errorDescription = 'error_description',
    state = 'state'
}

export type RedirectResponse = {
    QueryCode: string
    Verifier: string
    OriginPath: string
}

export type TokenResponse = {
    readonly access_token: string
    readonly token_type: string
    readonly expires_in: string
    readonly scope: string
    readonly refresh_token: string
    readonly id_token: string
}

export type TokenError = {
    readonly error: string
    readonly error_description: string
    readonly error_codes: string[] | number[]
    readonly timestamp: string
    readonly trace_id: string
    readonly correlation_id: string
}