import type { ComponentType } from 'react';

export type AuthPaths = {
  login: string;
  loginCallback: string;
  logout: string;
};

export type AuthError = {
  readonly message: string;
  readonly code: string;
};

export type AuthStage = 'login' | 'loginCallback' | 'logout';
export type AuthMessages = Partial<Record<AuthStage, string>>;

export type AuthHookError = AuthError & { readonly stage: AuthStage };

export type AuthClientOptions<Profile = unknown> = {
  readonly clientId: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly endSessionEndpoint?: string;
  readonly postLogoutRedirectUri?: string;
  readonly scopes?: readonly string[];
  readonly appBaseUrl?: string;
  readonly redirectUri?: string;
  readonly paths?: Partial<AuthPaths>;
  readonly oidc?: OidcOptions;
  readonly loadProfile?: (context: { readonly accessToken: string }) => Promise<Profile>;
  readonly hooks?: AuthLifecycleHooks;
};

export type OidcOptions = {
  readonly issuer: string;
  readonly jwksUri: string;
  readonly clockSkewSeconds?: number;
};

export type VerifiedIdTokenClaims = {
  readonly iss: string;
  readonly aud: string | readonly string[];
  readonly sub: string;
  readonly exp: number;
  readonly iat: number;
  readonly nonce?: string;
  readonly azp?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
  readonly name?: string;
  readonly picture?: string;
};

export type AuthLifecycleHooks = {
  readonly onLoginStart?: () => void | Promise<void>;
  readonly onLoginCallbackStart?: () => void | Promise<void>;
  readonly afterTokenExchange?: (event: { readonly accessToken: string }) => void | Promise<void>;
  readonly onLoginComplete?: (event: { readonly accessToken: string }) => void | Promise<void>;
  readonly onLoginError?: (event: AuthHookError) => void | Promise<void>;
  readonly onTokenRenewed?: (event: { readonly accessToken: string }) => void | Promise<void>;
  readonly onLogoutStart?: () => void | Promise<void>;
  readonly onLogout?: () => void | Promise<void>;
  readonly onLogoutError?: (event: AuthHookError) => void | Promise<void>;
};

export type NormalizedAuthConfig<Profile = unknown> = AuthClientOptions<Profile> & {
  readonly appBaseUrl: string;
  readonly redirectUri: string;
  readonly paths: AuthPaths;
  readonly routeUrls: { readonly login: string; readonly loginCallback: string; readonly logout: string };
};

export type LoginViewProps = {
  readonly status: 'redirecting' | 'error';
  readonly error: AuthError | null;
};

export type LoginCallbackViewProps = {
  readonly status: 'processing' | 'complete' | 'error';
  readonly error: AuthError | null;
};

export type LogoutViewProps = {
  readonly status: 'loggingOut' | 'complete' | 'error';
  readonly error: AuthError | null;
};

export type AuthViews = {
  readonly LoginView?: ComponentType<LoginViewProps>;
  readonly LoginCallbackView?: ComponentType<LoginCallbackViewProps>;
  readonly LogoutView?: ComponentType<LogoutViewProps>;
};

export interface AuthNavigationAdapter {
  readonly navigate: (options: { readonly to: string; readonly replace: boolean }) => void | Promise<void>;
  readonly getLocation: () => string;
  readonly subscribe: (listener: () => void) => () => void;
}

export type AcquireTokenOptions = {
  readonly returnTo?: string;
};

export type TokenRunResult<Result> =
  | { readonly status: 'completed'; readonly value: Result }
  | { readonly status: 'redirecting' };

export type TokenRunnerOptions = {
  readonly returnTo?: string | (() => string);
  readonly onRedirectNeeded?: () => void | Promise<void>;
};

export type LogoutOptions = {
  readonly returnTo?: string;
};

export type LogoutResult =
  | { readonly status: 'redirecting' }
  | { readonly status: 'complete'; readonly returnTo: string | null };

export type AuthTransaction = {
  readonly clientId: string;
  readonly state: string;
  readonly verifier: string;
  readonly createdAt: number;
  readonly nonce?: string;
};

export type OAuthTokenResponse = {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
  readonly scope?: string;
  readonly id_token?: string;
};

export type StoredTokenRecord = {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly expiresAt: number;
  readonly refreshToken?: string;
  readonly idToken?: string;
  readonly grantedScopes?: readonly string[];
};

export type OAuthProtocolError = {
  readonly error: string;
  readonly error_description?: string;
};

export type AuthStatus = 'initializing' | 'anonymous' | 'authenticated';

export type AuthSnapshot<Profile = unknown> = {
  readonly status: AuthStatus;
  readonly isRefreshing: boolean;
  readonly authError: AuthError | null;
  readonly grantedScopes: readonly string[] | null;
  readonly profile: Profile | null;
  readonly profileStatus: 'idle' | 'loading' | 'loaded' | 'error';
  readonly profileError: AuthError | null;
  readonly idTokenClaims: VerifiedIdTokenClaims | null;
};
