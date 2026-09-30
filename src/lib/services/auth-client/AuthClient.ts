import type {
  AcquireTokenOptions,
  AuthClientOptions,
  AuthNavigationAdapter,
  AuthSnapshot,
  TokenRunResult,
  TokenRunnerOptions,
  AuthError,
  OAuthProtocolError,
  OAuthTokenResponse,
  LogoutOptions,
  AuthTransaction,
  AuthLifecycleHooks,
  AuthStage,
  NormalizedAuthConfig,
  StoredTokenRecord,
  VerifiedIdTokenClaims,
} from '@/types';
import { AuthTransactionStorage } from '../token-storage/AuthTransactionStorage';
import { getTokenStorage, type TokenStorage } from '../token-storage/TokenStorage';
import { OidcIdentity, OidcKeySetError, OidcValidationError } from '../oidc-identity/OidcIdentity';
import { isAllowedReturnTo, normalizeAuthConfig } from './normalizeAuthConfig';

type AuthRouteSnapshot = { readonly stage: AuthStage | null; readonly entry: number };

export class AuthClient<Profile = unknown> {
  readonly config: NormalizedAuthConfig<Profile>;
  readonly transactions: AuthTransactionStorage;
  readonly storage: TokenStorage;
  private readonly oidcIdentity: OidcIdentity | null;
  private verifiedIdToken: string | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: AuthSnapshot<Profile> = {
    status: 'initializing',
    isRefreshing: false,
    authError: null,
    grantedScopes: null,
    profile: null,
    profileStatus: 'idle',
    profileError: null,
    idTokenClaims: null,
  };
  private profileSnapshot: Pick<AuthSnapshot<Profile>, 'profile' | 'profileStatus' | 'profileError'> = {
    profile: null,
    profileStatus: 'idle',
    profileError: null,
  };
  private refreshRequest: Promise<string | null> | null = null;
  private initializeRequest: Promise<void> | null = null;
  private loginStart: Promise<void> | null = null;
  private loginCallback: { readonly location: string; readonly promise: Promise<string> } | null = null;
  private loginStage: Promise<void> | null = null;
  private logoutComplete: Promise<string> | null = null;
  private navigationAdapter: AuthNavigationAdapter | undefined;
  private navigationObservers = 0;
  private readonly routeListeners = new Set<() => void>();
  private stopLocationSubscription: (() => void) | null = null;
  private routeSnapshot: AuthRouteSnapshot = { stage: null, entry: 0 };
  private authEpoch = 0;

  constructor(config: NormalizedAuthConfig<Profile>) {
    this.config = config;
    this.transactions = new AuthTransactionStorage(config.clientId);
    this.storage = getTokenStorage(config.clientId);
    this.oidcIdentity = config.oidc === undefined ? null : new OidcIdentity(config.oidc, config.clientId);
    this.routeSnapshot = { stage: this.readAuthRoute(), entry: 0 };
  }

  acquireToken = async (options: AcquireTokenOptions = {}): Promise<void> => {
    const current = this.getCurrentLocation();
    const returnTo = isAllowedReturnTo(options.returnTo ?? current, this.config);
    this.transactions.saveReturnTo(returnTo);
    try {
      await this.navigateTo(this.config.routeUrls.login);
    } catch (reason: unknown) {
      this.transactions.consumeReturnTo();
      throw reason;
    }
  };

  navigateTo = (url: string): void | Promise<void> => {
    const target = new URL(url, this.config.appBaseUrl);
    const base = new URL(this.config.appBaseUrl);
    if (target.origin !== window.location.origin || target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) {
      throw new AuthFlowError('INVALID_INTERNAL_NAVIGATION', 'Internal auth navigation must stay in the configured app.');
    }
    return this.commitNavigation(`${target.pathname}${target.search}${target.hash}`, false);
  };

  navigateInternal = (path: string, replace: boolean): void | Promise<void> => {
    const safePath = isAllowedReturnTo(path, this.config);
    const target = new URL(safePath, this.config.appBaseUrl);
    if (target.origin !== window.location.origin) {
      throw new AuthFlowError('INVALID_INTERNAL_NAVIGATION', 'Internal auth navigation must stay on the current origin.');
    }
    return this.commitNavigation(`${target.pathname}${target.search}${target.hash}`, replace);
  };

  clearCallbackParameters = (): void | Promise<void> => {
    const current = new URL(this.getCurrentLocation(), window.location.origin);
    if (this.readAuthRoute() !== 'loginCallback') return;
    return this.commitNavigation(current.pathname, true);
  };

  setNavigationAdapter = (adapter: AuthNavigationAdapter | undefined): void => {
    if (adapter === this.navigationAdapter) return;
    this.stopLocationSubscription?.();
    this.stopLocationSubscription = null;
    this.navigationAdapter = adapter;
    if (this.routeListeners.size > 0) this.startLocationSubscription();
    this.notifyRouteChange();
  };

  // Keep observation alive before stage effects, even without an AuthBoundary.
  observeNavigation = (adapter: AuthNavigationAdapter | undefined): (() => void) => {
    if (this.navigationObservers > 0 && adapter !== this.navigationAdapter) {
      throw new Error('Providers sharing an AuthClient must use the same navigation adapter.');
    }
    this.setNavigationAdapter(adapter);
    const unsubscribe = this.subscribeAuthRoute(() => undefined);
    this.navigationObservers += 1;
    return () => {
      unsubscribe();
      this.navigationObservers -= 1;
      if (this.navigationObservers > 0) return;
      this.stopLocationSubscription?.();
      this.stopLocationSubscription = null;
      this.navigationAdapter = undefined;
    };
  };

  getCurrentLocation = (): string => this.navigationAdapter?.getLocation() ??
    `${window.location.pathname}${window.location.search}${window.location.hash}`;

  getAuthRouteSnapshot = (): AuthRouteSnapshot => this.routeSnapshot;

  subscribeAuthRoute = (listener: () => void): (() => void) => {
    this.routeListeners.add(listener);
    if (this.stopLocationSubscription === null) this.startLocationSubscription();
    this.notifyRouteChange();
    return () => {
      this.routeListeners.delete(listener);
      if (this.routeListeners.size === 0) {
        this.stopLocationSubscription?.();
        this.stopLocationSubscription = null;
      }
    };
  };

  private startLocationSubscription(): void {
    if (this.navigationAdapter !== undefined) {
      this.stopLocationSubscription = this.navigationAdapter.subscribe(this.notifyRouteChange);
    } else {
      window.addEventListener('popstate', this.notifyRouteChange);
      this.stopLocationSubscription = () => window.removeEventListener('popstate', this.notifyRouteChange);
    }
  }

  private readAuthRoute(): AuthStage | null {
    const current = new URL(this.getCurrentLocation(), window.location.origin);
    const matches = (url: string): boolean => {
      const route = new URL(url);
      return current.origin === route.origin && current.pathname === route.pathname;
    };
    if (matches(this.config.routeUrls.login)) return 'login';
    if (matches(this.config.routeUrls.logout)) return 'logout';
    if (matches(this.config.routeUrls.loginCallback) || matches(this.config.redirectUri)) return 'loginCallback';
    return null;
  }

  private notifyRouteChange = (): void => {
    const next = this.readAuthRoute();
    if (next === this.routeSnapshot.stage) return;
    if (this.routeSnapshot.stage !== null) {
      this.authEpoch += 1;
      this.loginStart = null;
      this.loginStage = null;
      this.loginCallback = null;
      this.logoutComplete = null;
    }
    this.routeSnapshot = { stage: next, entry: this.routeSnapshot.entry + 1 };
    this.routeListeners.forEach((listener) => listener());
  };

  private commitNavigation(to: string, replace: boolean): void | Promise<void> {
    const target = new URL(to, window.location.origin);
    if (target.origin !== window.location.origin) {
      throw new AuthFlowError('INVALID_INTERNAL_NAVIGATION', 'Internal auth navigation must stay on the current origin.');
    }
    if (this.navigationAdapter !== undefined) return this.navigationAdapter.navigate({ to, replace });
    if (replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }

  logout = async (options: LogoutOptions = {}): Promise<void> => {
    const returnTo = isAllowedReturnTo(options.returnTo ?? new URL(this.config.appBaseUrl).pathname, this.config);
    this.transactions.saveReturnTo(returnTo);
    try {
      await this.navigateTo(this.config.routeUrls.logout);
    } catch (reason: unknown) {
      this.transactions.consumeReturnTo();
      throw reason;
    }
  };

  completeLogout = (): Promise<string> => {
    if (this.logoutComplete !== null) return this.logoutComplete;
    this.logoutComplete = this.performLogout();
    return this.logoutComplete;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): AuthSnapshot<Profile> => this.snapshot;
  getStatusSnapshot = (): AuthSnapshot<Profile>['status'] => this.snapshot.status;
  getProfileSnapshot = (): Pick<AuthSnapshot<Profile>, 'profile' | 'profileStatus' | 'profileError'> => this.profileSnapshot;

  initialize = (): Promise<void> => {
    if (this.initializeRequest !== null) return this.initializeRequest;
    this.initializeRequest = this.performInitialize();
    return this.initializeRequest;
  };

  private async performInitialize(): Promise<void> {
    const operationEpoch = this.authEpoch;
    try {
      const token = await this.getToken();
      if (operationEpoch !== this.authEpoch) return;
      this.setSnapshot({ status: token === null ? 'anonymous' : 'authenticated', isRefreshing: false, authError: null });
      if (token !== null) await this.loadProfile(token, operationEpoch);
    } catch (reason: unknown) {
      if (operationEpoch !== this.authEpoch) return;
      this.setSnapshot({
        status: 'initializing',
        isRefreshing: false,
        authError: normalizeFlowError(reason, 'AUTH_INITIALIZATION_FAILED'),
      });
    }
  }

  getToken = async (): Promise<string | null> => {
    const operationEpoch = this.authEpoch;
    const record = this.storage.getRecord();
    let token = record !== null && record.expiresAt > Date.now() + 30_000
      ? record.accessToken
      : null;
    let idTokenClaims = this.snapshot.idTokenClaims;
    if (token !== null && this.oidcIdentity !== null) {
      try {
        if (record?.idToken === undefined) throw new OidcValidationError('A verified ID token is required.');
        if (record.idToken !== this.verifiedIdToken || idTokenClaims === null || idTokenClaims.exp <= Date.now() / 1000) {
          idTokenClaims = await this.oidcIdentity.validate(record.idToken);
          if (operationEpoch !== this.authEpoch) return null;
          this.verifiedIdToken = record.idToken;
        }
      } catch (reason: unknown) {
        if (operationEpoch !== this.authEpoch) return null;
        if (!(reason instanceof OidcValidationError)) {
          const authError = normalizeFlowError(reason, reason instanceof OidcKeySetError ? 'OIDC_KEY_SET_UNAVAILABLE' : 'OIDC_VALIDATION_UNAVAILABLE');
          this.setSnapshot({ ...this.snapshot, authError });
          throw reason;
        }
        this.storage.clear();
        this.verifiedIdToken = null;
        idTokenClaims = null;
        token = null;
      }
    }
    this.setSnapshot({
      status: token === null ? 'anonymous' : 'authenticated',
      isRefreshing: this.snapshot.isRefreshing,
      authError: null,
      grantedScopes: token === null ? null : record?.grantedScopes ?? null,
      profile: token === null ? null : this.snapshot.profile,
      profileStatus: token === null ? 'idle' : this.snapshot.profileStatus,
      profileError: token === null ? null : this.snapshot.profileError,
      idTokenClaims: token === null ? null : idTokenClaims,
    });
    return token;
  };

  getRefreshToken = async (): Promise<string | null> => {
    return this.storage.getRecord()?.refreshToken ?? null;
  };

  silentRenewToken = (): Promise<string | null> => {
    if (this.refreshRequest !== null) return this.refreshRequest;
    this.refreshRequest = this.performSilentRenew().finally(() => { this.refreshRequest = null; });
    return this.refreshRequest;
  };

  getGrantedScopes = (): readonly string[] | null => {
    return this.storage.getRecord()?.grantedScopes ?? null;
  };

  getProfile = (): Profile | null => this.snapshot.profile;

  getIdTokenClaims = (): VerifiedIdTokenClaims | null => this.snapshot.idTokenClaims;

  runWithToken = async <Result>(
    operation: (accessToken: string) => Promise<Result>,
    options: TokenRunnerOptions = {},
  ): Promise<TokenRunResult<Result>> => {
    const operationEpoch = this.authEpoch;
    let accessToken = await this.getToken();
    if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed before the request could start.');
    if (accessToken === null) accessToken = await this.silentRenewToken();
    if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed before the request could start.');
    if (accessToken !== null) {
      return { status: 'completed', value: await operation(accessToken) };
    }

    await options.onRedirectNeeded?.();
    if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed before login could start.');
    const returnTo = typeof options.returnTo === 'function' ? options.returnTo() : options.returnTo;
    await this.acquireToken(returnTo === undefined ? {} : { returnTo });
    return { status: 'redirecting' };
  };

  withToken = <Arguments extends unknown[], Result>(
    operation: (accessToken: string, ...args: Arguments) => Promise<Result>,
    options: TokenRunnerOptions = {},
  ): ((...args: Arguments) => Promise<TokenRunResult<Result>>) => {
    return (...args: Arguments) => this.runWithToken((accessToken) => operation(accessToken, ...args), options);
  };

  startLogin(): Promise<void> {
    if (this.loginStart !== null) return this.loginStart;
    const operationEpoch = this.authEpoch;
    this.loginStart = this.performLoginStart().catch((reason: unknown) => {
      if (operationEpoch === this.authEpoch) this.transactions.clear();
      throw reason;
    });
    return this.loginStart;
  }

  enterLoginStage(): Promise<void> {
    if (this.loginStage !== null) return this.loginStage;
    this.loginStage = this.enterLoginStageOnce();
    return this.loginStage;
  }

  completeLogin(): Promise<string> {
    const location = this.getCurrentLocation();
    if (this.loginCallback?.location === location) return this.loginCallback.promise;
    const promise = this.performLoginCallback(location);
    this.loginCallback = { location, promise };
    return promise;
  }

  private async performLoginStart(): Promise<void> {
    const operationEpoch = this.authEpoch;
    const verifier = randomString(64, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~');
    const state = randomString(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_');
    const nonce = this.oidcIdentity === null ? undefined : randomString(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_');
    const transaction: AuthTransaction = {
      clientId: this.config.clientId,
      state,
      verifier,
      createdAt: Date.now(),
      ...(nonce === undefined ? {} : { nonce }),
    };
    this.transactions.save(transaction);

    const authorizationUrl = await buildAuthorizationUrl(this.config, state, verifier, nonce);

    if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Login was canceled before leaving for the provider.');
    await this.config.hooks?.onLoginStart?.();
    if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Login was canceled before leaving for the provider.');
    window.location.assign(authorizationUrl.href);
  }

  private async enterLoginStageOnce(): Promise<void> {
    const operationEpoch = this.authEpoch;
    const accessToken = await this.getToken();
    if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Login was canceled before leaving for the provider.');
    if (accessToken !== null) {
      const returnTo = this.transactions.consumeReturnTo() ?? new URL(this.config.appBaseUrl).pathname;
      await this.navigateInternal(returnTo, true);
      return;
    }
    await this.startLogin();
  }

  private async performLoginCallback(location: string): Promise<string> {
    const operationEpoch = this.authEpoch;
    let committedCallbackTokens = false;
    try {
      await this.config.hooks?.onLoginCallbackStart?.();
      if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while login was in progress.');
      const parameters = new URL(location, window.location.origin).searchParams;
      if (parameters.has('error')) {
        const error = parameters.get('error') ?? 'authorization_error';
        const description = parameters.get('error_description') ?? 'The authorization server returned an error.';
        throw new AuthFlowError(error, description);
      }
      const code = parameters.get('code');
      const returnedState = parameters.get('state');
      if (code === null || code.length === 0) throw new AuthFlowError('MISSING_CODE', 'Authorization code is missing.');
      if (returnedState === null || returnedState.length === 0) throw new AuthFlowError('MISSING_STATE', 'OAuth state is missing.');

      const transaction = this.transactions.consume();
      if (transaction === null) {
        if (await this.getToken() !== null) return new URL(this.config.appBaseUrl).pathname;
        throw new AuthFlowError('MISSING_TRANSACTION', 'The login transaction is missing or expired.');
      }
      if (transaction.clientId !== this.config.clientId) {
        throw new AuthFlowError('MISSING_TRANSACTION', 'The login transaction is missing or expired.');
      }
      if (returnedState !== transaction.state) throw new AuthFlowError('STATE_MISMATCH', 'OAuth state did not match the login request.');

      const response = await fetch(this.config.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.config.clientId,
          code,
          code_verifier: transaction.verifier,
          redirect_uri: this.config.redirectUri,
        }),
      });
      const payload: unknown = await response.json();
      if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while login was in progress.');
      if (!response.ok) throw asOAuthError(payload, 'TOKEN_EXCHANGE_FAILED');
      if (isOAuthProtocolError(payload)) throw new AuthFlowError(payload.error, payload.error_description ?? 'Token exchange failed.');
      if (!isOAuthTokenResponse(payload)) throw new AuthFlowError('INVALID_TOKEN_RESPONSE', 'The token endpoint returned an invalid response.');

      const token = payload;
      let idTokenClaims: VerifiedIdTokenClaims | null = null;
      if (this.oidcIdentity !== null) {
        if (token.id_token === undefined || transaction.nonce === undefined) {
          throw new AuthFlowError('MISSING_ID_TOKEN', 'The OIDC login response is missing its ID token or nonce.');
        }
        idTokenClaims = await this.oidcIdentity.validate(token.id_token, transaction.nonce);
      }
      await this.config.hooks?.afterTokenExchange?.({ accessToken: token.access_token });
      const record: StoredTokenRecord = {
        accessToken: token.access_token,
        tokenType: token.token_type,
        expiresAt: Date.now() + token.expires_in * 1000,
        ...(token.refresh_token === undefined ? {} : { refreshToken: token.refresh_token }),
        ...(token.id_token === undefined ? {} : { idToken: token.id_token }),
        ...(token.scope === undefined
          ? (this.config.scopes === undefined ? {} : { grantedScopes: this.config.scopes })
          : { grantedScopes: splitScopes(token.scope) }),
      };
      if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while login was in progress.');
      this.storage.save(record);
      committedCallbackTokens = true;
      this.setSnapshot({
        status: 'authenticated', isRefreshing: false, authError: null,
        grantedScopes: record.grantedScopes ?? null, profile: null,
        profileStatus: 'idle', profileError: null, idTokenClaims,
      });
      this.verifiedIdToken = token.id_token ?? null;
      await this.config.hooks?.onLoginComplete?.({ accessToken: token.access_token });
      if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while login was in progress.');
      await this.loadProfile(token.access_token, operationEpoch);
      if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while login was in progress.');
      const savedReturnTo = this.transactions.consumeReturnTo() ?? this.config.appBaseUrl;
      return isAllowedReturnTo(savedReturnTo, this.config);
    } catch (reason: unknown) {
      if (operationEpoch !== this.authEpoch) {
        throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while login was in progress.');
      }
      this.transactions.clear();
      const savedRecord = this.storage.getRecord();
      const existingSessionIsUsable = !committedCallbackTokens && savedRecord !== null &&
        savedRecord.expiresAt > Date.now() + 30_000 &&
        (this.oidcIdentity === null || await this.getToken() !== null);
      if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while login was in progress.');
      if (!existingSessionIsUsable) {
        this.storage.clear();
        this.verifiedIdToken = null;
      }
      this.setSnapshot({
        status: existingSessionIsUsable ? 'authenticated' : 'anonymous',
        isRefreshing: false,
        grantedScopes: existingSessionIsUsable ? savedRecord?.grantedScopes ?? null : null,
        profile: existingSessionIsUsable ? this.snapshot.profile : null,
        profileStatus: existingSessionIsUsable ? this.snapshot.profileStatus : 'idle',
        profileError: existingSessionIsUsable ? this.snapshot.profileError : null,
        idTokenClaims: existingSessionIsUsable ? this.snapshot.idTokenClaims : null,
      });
      const error = normalizeFlowError(reason, 'LOGIN_CALLBACK_FAILED');
      try {
        await this.config.hooks?.onLoginError?.({ ...error, stage: 'loginCallback' });
      } catch {
        // Report the original flow failure; an observer cannot replace it.
      }
      throw new AuthFlowError(error.code, error.message);
    }
  }

  private async performSilentRenew(): Promise<string | null> {
    const operationEpoch = this.authEpoch;
    const current = this.storage.getRecord();
    if (current?.refreshToken === undefined || current.refreshToken.length === 0) return null;
    this.setSnapshot({ ...this.snapshot, isRefreshing: true, authError: null });

    try {
      const response = await fetch(this.config.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: current.refreshToken,
          client_id: this.config.clientId,
        }),
      });
      const payload: unknown = await response.json();
      if (operationEpoch !== this.authEpoch) {
        throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while token renewal was in progress.');
      }
      if (isOAuthProtocolError(payload) && payload.error === 'invalid_grant') {
        this.storage.clear();
        this.verifiedIdToken = null;
        this.setSnapshot({ status: 'anonymous', isRefreshing: false, authError: null, grantedScopes: null, profile: null, profileStatus: 'idle', profileError: null, idTokenClaims: null });
        return null;
      }
      if (!response.ok) throw asOAuthError(payload, 'TOKEN_RENEWAL_FAILED');
      if (!isOAuthTokenResponse(payload)) throw new AuthFlowError('INVALID_TOKEN_RESPONSE', 'The token endpoint returned an invalid response.');

      const token = payload;
      let idTokenClaims: VerifiedIdTokenClaims | null = this.snapshot.idTokenClaims;
      if (this.oidcIdentity !== null) {
        if (token.id_token !== undefined) {
          idTokenClaims = await this.oidcIdentity.validate(token.id_token);
          this.verifiedIdToken = token.id_token;
        } else if (current.idToken !== undefined) {
          try {
            idTokenClaims = await this.oidcIdentity.validate(current.idToken);
            this.verifiedIdToken = current.idToken;
          } catch (reason: unknown) {
            if (operationEpoch !== this.authEpoch) {
              throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while token renewal was in progress.');
            }
            if (!(reason instanceof OidcValidationError)) throw reason;
            this.storage.clear();
            this.verifiedIdToken = null;
            this.setSnapshot({
              status: 'anonymous', isRefreshing: false, authError: null, grantedScopes: null,
              profile: null, profileStatus: 'idle', profileError: null, idTokenClaims: null,
            });
            return null;
          }
        } else {
          this.storage.clear();
          this.verifiedIdToken = null;
          this.setSnapshot({
            status: 'anonymous', isRefreshing: false, authError: null, grantedScopes: null,
            profile: null, profileStatus: 'idle', profileError: null, idTokenClaims: null,
          });
          return null;
        }
      }
      const renewed: StoredTokenRecord = {
        ...current,
        accessToken: token.access_token,
        tokenType: token.token_type,
        expiresAt: Date.now() + token.expires_in * 1000,
        ...(token.refresh_token === undefined ? {} : { refreshToken: token.refresh_token }),
        ...(token.id_token === undefined ? {} : { idToken: token.id_token }),
        ...(token.scope === undefined ? {} : { grantedScopes: splitScopes(token.scope) }),
      };
      if (operationEpoch !== this.authEpoch) {
        throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while token renewal was in progress.');
      }
      this.storage.save(renewed);
      this.setSnapshot({
        status: 'authenticated', isRefreshing: false, authError: null,
        grantedScopes: renewed.grantedScopes ?? null,
        idTokenClaims,
      });
      await this.config.hooks?.onTokenRenewed?.({ accessToken: token.access_token });
      if (operationEpoch !== this.authEpoch) {
        throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while token renewal was in progress.');
      }
      await this.loadProfile(token.access_token, operationEpoch);
      if (operationEpoch !== this.authEpoch) {
        throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while token renewal was in progress.');
      }
      return token.access_token;
    } catch (reason: unknown) {
      if (operationEpoch === this.authEpoch) {
        this.setSnapshot({
          ...this.snapshot,
          isRefreshing: false,
          authError: normalizeFlowError(reason, 'TOKEN_RENEWAL_FAILED'),
        });
      }
      throw reason;
    }
  }

  private async loadProfile(accessToken: string, operationEpoch: number = this.authEpoch): Promise<void> {
    const loader = this.config.loadProfile;
    if (loader === undefined) return;
    if (operationEpoch !== this.authEpoch || this.storage.getRecord()?.accessToken !== accessToken) return;
    this.setSnapshot({ ...this.snapshot, profileStatus: 'loading', profileError: null });
    try {
      const profile = await loader({ accessToken });
      if (operationEpoch !== this.authEpoch || this.storage.getRecord()?.accessToken !== accessToken) return;
      this.setSnapshot({ ...this.snapshot, profile, profileStatus: 'loaded', profileError: null });
    } catch (reason: unknown) {
      if (operationEpoch !== this.authEpoch || this.storage.getRecord()?.accessToken !== accessToken) return;
      this.setSnapshot({
        ...this.snapshot,
        profileStatus: 'error',
        profileError: reason instanceof Error
          ? { code: 'PROFILE_LOAD_FAILED', message: reason.message }
          : { code: 'PROFILE_LOAD_FAILED', message: 'The profile could not be loaded.' },
      });
    }
  }

  private setSnapshot(snapshot: Partial<AuthSnapshot<Profile>>): void {
    const proposed: AuthSnapshot<Profile> = {
      ...this.snapshot,
      ...snapshot,
      grantedScopes: snapshot.grantedScopes !== undefined ? snapshot.grantedScopes : this.snapshot.grantedScopes,
      profile: snapshot.profile !== undefined ? snapshot.profile : this.snapshot.profile,
      profileStatus: snapshot.profileStatus !== undefined ? snapshot.profileStatus : this.snapshot.profileStatus,
      profileError: snapshot.profileError !== undefined ? snapshot.profileError : this.snapshot.profileError,
      authError: snapshot.authError !== undefined ? snapshot.authError : this.snapshot.authError,
      idTokenClaims: snapshot.idTokenClaims !== undefined ? snapshot.idTokenClaims : this.snapshot.idTokenClaims,
    };
    const next: AuthSnapshot<Profile> = sameScopes(this.snapshot.grantedScopes, proposed.grantedScopes)
      ? { ...proposed, grantedScopes: this.snapshot.grantedScopes }
      : proposed;
    if (this.snapshot.status === next.status && this.snapshot.isRefreshing === next.isRefreshing &&
      this.snapshot.grantedScopes === next.grantedScopes && this.snapshot.profile === next.profile &&
      this.snapshot.profileStatus === next.profileStatus && this.snapshot.profileError === next.profileError &&
      this.snapshot.authError === next.authError &&
      this.snapshot.idTokenClaims === next.idTokenClaims) return;
    if (this.profileSnapshot.profile !== next.profile ||
      this.profileSnapshot.profileStatus !== next.profileStatus ||
      this.profileSnapshot.profileError !== next.profileError) {
      this.profileSnapshot = {
        profile: next.profile,
        profileStatus: next.profileStatus,
        profileError: next.profileError,
      };
    }
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  private async performLogout(): Promise<string> {
    this.authEpoch += 1;
    const operationEpoch = this.authEpoch;
    const savedReturnTo = this.transactions.consumeReturnTo() ?? this.config.appBaseUrl;
    let failure: AuthError | null = null;
    try {
      await this.config.hooks?.onLogoutStart?.();
    } catch (reason: unknown) {
      failure = normalizeFlowError(reason, 'LOGOUT_START_FAILED');
    }

    if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while logout was in progress.');
    this.storage.clear();
    this.transactions.clear();
    this.setSnapshot({
      status: 'anonymous', isRefreshing: false, grantedScopes: null,
      authError: null, profile: null, profileStatus: 'idle', profileError: null, idTokenClaims: null,
    });
    this.verifiedIdToken = null;
    if (failure === null) {
      try {
        await this.config.hooks?.onLogout?.();
      } catch (reason: unknown) {
        failure = normalizeFlowError(reason, 'LOGOUT_FAILED');
      }
    }
    if (operationEpoch !== this.authEpoch) throw new AuthFlowError('SESSION_CHANGED', 'Authentication changed while logout was in progress.');
    if (failure !== null) {
      try {
        await this.config.hooks?.onLogoutError?.({ ...failure, stage: 'logout' });
      } catch {
        // Local logout is complete even if an observer hook fails.
      }
      throw new AuthFlowError(failure.code, failure.message);
    }
    return isAllowedReturnTo(savedReturnTo, this.config);
  }
}

function sameScopes(left: readonly string[] | null, right: readonly string[] | null): boolean {
  return left === right || (left !== null && right !== null && left.length === right.length &&
    left.every((scope, index) => scope === right[index]));
}

export class AuthFlowError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthFlowError';
    this.code = code;
  }
}

export async function buildAuthorizationUrl<Profile>(
  config: NormalizedAuthConfig<Profile>,
  state: string,
  verifier: string,
  nonce?: string,
): Promise<URL> {
  const authorizationUrl = new URL(config.authorizationEndpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', config.clientId);
  authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
  if (config.scopes !== undefined && config.scopes.length > 0) {
    authorizationUrl.searchParams.set('scope', config.scopes.join(' '));
  }
  authorizationUrl.searchParams.set('code_challenge', await createChallenge(verifier));
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  authorizationUrl.searchParams.set('state', state);
  if (nonce !== undefined) authorizationUrl.searchParams.set('nonce', nonce);
  return authorizationUrl;
}

type RegisteredClient = { readonly fingerprint: string; readonly instance: object };
const clients = new Map<string, RegisteredClient>();

export function createAuthClient<Profile = unknown>(options: AuthClientOptions<Profile>): AuthClient<Profile> {
  const config = normalizeAuthConfig(options);
  const fingerprint = getFingerprint(config);
  const registered = clients.get(config.clientId);
  if (registered !== undefined) {
    if (registered.fingerprint !== fingerprint) {
      throw new Error(`Conflicting auth configuration for clientId "${config.clientId}"`);
    }
    return registered.instance as AuthClient<Profile>;
  }

  const client = new AuthClient(config);
  clients.set(config.clientId, { fingerprint, instance: client });
  return client;
}

const callbackIds = new WeakMap<object, number>();
let nextCallbackId = 1;

function callbackId(callback: object | undefined): number | null {
  if (callback === undefined) return null;
  const existing = callbackIds.get(callback);
  if (existing !== undefined) return existing;
  const id = nextCallbackId;
  nextCallbackId += 1;
  callbackIds.set(callback, id);
  return id;
}

function getFingerprint<Profile>(config: NormalizedAuthConfig<Profile>): string {
  const hookNames = Object.keys(config.hooks ?? {}) as Array<keyof AuthLifecycleHooks>;
  return JSON.stringify({
    authorizationEndpoint: config.authorizationEndpoint,
    tokenEndpoint: config.tokenEndpoint,
    scopes: config.scopes,
    appBaseUrl: config.appBaseUrl,
    redirectUri: config.redirectUri,
    paths: config.paths,
    oidc: config.oidc,
    loadProfile: callbackId(config.loadProfile),
    hooks: hookNames.sort().map((name) => [name, callbackId(config.hooks?.[name])]),
  });
}

function randomString(length: number, alphabet: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function createChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  new Uint8Array(digest).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isOAuthTokenResponse(value: unknown): value is OAuthTokenResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return typeof response.access_token === 'string' && response.access_token.length > 0 &&
    typeof response.token_type === 'string' && response.token_type.toLowerCase() === 'bearer' &&
    typeof response.expires_in === 'number' && Number.isFinite(response.expires_in) && response.expires_in > 0 &&
    (response.refresh_token === undefined || typeof response.refresh_token === 'string') &&
    (response.scope === undefined || typeof response.scope === 'string') &&
    (response.id_token === undefined || typeof response.id_token === 'string');
}

function isOAuthProtocolError(value: unknown): value is OAuthProtocolError {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return typeof response.error === 'string';
}

function asOAuthError(value: unknown, fallbackCode: string): AuthFlowError {
  if (isOAuthProtocolError(value)) {
    return new AuthFlowError(value.error, value.error_description ?? 'The token endpoint rejected the request.');
  }
  return new AuthFlowError(fallbackCode, 'The token endpoint returned an HTTP error.');
}

function normalizeFlowError(reason: unknown, fallbackCode: string): AuthError {
  if (reason instanceof AuthFlowError) return { code: reason.code, message: reason.message };
  if (reason instanceof Error) return { code: fallbackCode, message: reason.message };
  return { code: fallbackCode, message: 'The login callback could not be completed.' };
}

function splitScopes(scope: string): readonly string[] {
  return scope.trim().split(/\s+/).filter((value) => value.length > 0);
}
