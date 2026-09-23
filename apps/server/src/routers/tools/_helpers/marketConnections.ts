import type { ListConnectionsResponse, MarketSDK } from '@lobehub/market-sdk';

export const MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS = 10_000;

type MarketConnectCallable = Pick<MarketSDK['connect'], 'listConnections'>;

/**
 * Auth fields the timeout helper reads. They are protected (`headers`) or
 * private (`clientId` / `clientSecret`) on `ConnectService`, so intersecting
 * them into the parameter type makes the real SDK class unassignable.
 * Plain test doubles still pass them; `ConnectService` matches the callable
 * half of the union and `hasMarketSdkAuth` reads the fields through a cast.
 */
type MarketConnectWithAuth = MarketConnectCallable & {
  /** M2M client id. Present on the SDK when `clientCredentials` / `clientId` is set. */
  clientId?: string;
  /** M2M client secret. Paired with `clientId`; the SDK fetches a token only when both are set. */
  clientSecret?: string;
  /** Shared SDK headers. Present at runtime on `MarketSDK` and `MarketSDK.connect`. */
  headers?: Record<string, string>;
};

type MarketConnectClient = MarketConnectCallable | MarketConnectWithAuth;

const headerValue = (headers: Record<string, string> | undefined, name: string) => {
  if (!headers) return undefined;

  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }

  return undefined;
};

const hasBearerAccessToken = (headers?: Record<string, string>) => {
  const authorization = headerValue(headers, 'authorization');
  return Boolean(authorization && /^Bearer\s+\S+/i.test(authorization));
};

const hasTrustedClientToken = (headers?: Record<string, string>) =>
  Boolean(headerValue(headers, 'x-lobe-trust-token'));

const hasClientCredentials = (client: { clientId?: unknown; clientSecret?: unknown }) =>
  typeof client.clientId === 'string' &&
  client.clientId.trim().length > 0 &&
  typeof client.clientSecret === 'string' &&
  client.clientSecret.trim().length > 0;

/**
 * True when the Market SDK can authenticate a request.
 *
 * `requireMarketAuth` and `MarketSDK` accept three methods: a bearer access
 * token (or API key) on `Authorization`, a trusted-client token on
 * `x-lobe-trust-token`, and M2M `clientId` + `clientSecret` (the SDK exchanges
 * those for a bearer token inside `request`). Missing only the bearer token
 * is not "no auth".
 */
export const hasMarketSdkAuth = (client: object | null | undefined): boolean => {
  if (!client) return false;

  const record = client as MarketConnectWithAuth & { connect?: MarketConnectWithAuth };
  const candidates = [record, record.connect].filter(
    (candidate): candidate is MarketConnectWithAuth => !!candidate && typeof candidate === 'object',
  );

  return candidates.some(
    (candidate) =>
      hasBearerAccessToken(candidate.headers) ||
      hasTrustedClientToken(candidate.headers) ||
      hasClientCredentials(candidate),
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getStringField = (value: unknown, key: string) => {
  if (!isRecord(value)) return;

  const field = value[key];
  return typeof field === 'string' ? field : undefined;
};

const includesAuthError = (value?: string) => {
  const normalized = value?.toLowerCase();

  if (!normalized) return false;

  return (
    normalized === 'unauthorized' ||
    normalized === 'invalid_token' ||
    normalized === 'token_expired' ||
    normalized.includes('missing bearer token') ||
    normalized.includes('unauthorized') ||
    normalized.includes('invalid_token') ||
    normalized.includes('token expired')
  );
};

export const isMarketConnectionsAuthError = (error: unknown): boolean => {
  if (!isRecord(error)) return false;

  const status = error.status;
  const errorBody = error.errorBody;

  return (
    status === 401 ||
    includesAuthError(getStringField(error, 'name')) ||
    includesAuthError(getStringField(error, 'message')) ||
    includesAuthError(getStringField(errorBody, 'error')) ||
    includesAuthError(getStringField(errorBody, 'error_description'))
  );
};

export const isMarketConnectionsTimeoutError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

export const listMarketConnectionsWithTimeout = async (
  marketConnect: MarketConnectClient,
  timeoutMs = MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS,
): Promise<ListConnectionsResponse> => {
  return marketConnect.listConnections({
    signal: AbortSignal.timeout(timeoutMs),
  });
};

export const listOptionalMarketConnectionsWithTimeout = async (
  marketConnect: MarketConnectClient,
  timeoutMs = MARKET_CONNECTIONS_REQUEST_TIMEOUT_MS,
): Promise<ListConnectionsResponse> => {
  // Skip the HTTP call only when the SDK has none of its auth methods.
  // A bearer-less trusted-client or M2M client still authenticates, and
  // calling without any of them makes the SDK log
  // `Request error: {"error":"unauthorized","error_description":"Missing bearer token"}`.
  if (!hasMarketSdkAuth(marketConnect)) {
    return { connections: [], success: true };
  }

  try {
    return await listMarketConnectionsWithTimeout(marketConnect, timeoutMs);
  } catch (error) {
    if (isMarketConnectionsAuthError(error)) {
      return { connections: [], success: true };
    }

    throw error;
  }
};
