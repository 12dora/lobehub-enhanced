import type {
  DingTalkCreateCardParams,
  DingTalkDownloadedFile,
  DingTalkStreamCardParams,
  DingTalkUpdateCardParams,
} from './types';
import {
  DINGTALK_API_BASE,
  DINGTALK_OAPI_BASE,
  DingTalkApiError,
  DingTalkCardUnavailableError,
  TOKEN_REFRESH_SKEW_MS,
} from './types';

interface TokenCache {
  expiresAt: number;
  token: string;
}

const guessMime = (filename?: string): string | undefined => {
  if (!filename) return undefined;
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': {
      return 'image/png';
    }
    case 'jpg':
    case 'jpeg': {
      return 'image/jpeg';
    }
    case 'gif': {
      return 'image/gif';
    }
    case 'webp': {
      return 'image/webp';
    }
    case 'pdf': {
      return 'application/pdf';
    }
    case 'mp3': {
      return 'audio/mpeg';
    }
    case 'mp4': {
      return 'video/mp4';
    }
    default: {
      return undefined;
    }
  }
};

const parseFilename = (contentDisposition?: string | null): string | undefined => {
  if (!contentDisposition) return undefined;
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1].replaceAll('"', ''));
  const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return match?.[1];
};

const readErrorBody = async (
  response: Response,
): Promise<{ code?: string; message?: string; raw: string }> => {
  const raw = await response.text();
  try {
    const json = JSON.parse(raw) as Record<string, unknown>;
    const code = json.code ?? json.errcode;
    const message = json.message ?? json.errmsg ?? json.msg;
    return {
      code: code === undefined || code === null ? undefined : String(code),
      message: typeof message === 'string' ? message : undefined,
      raw,
    };
  } catch {
    return { raw };
  }
};

/**
 * DingTalk recall may return HTTP 200 with `failedResult: { [processQueryKey]: reason }`
 * (e.g. `notRevoke.all.messages`) instead of a non-OK status or `code`. Treat
 * that as a failed recall without throwing so callers can still send the answer.
 */
const recallFailedResultKeys = (data: unknown): string[] => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const failedResult = (data as Record<string, unknown>).failedResult;
  if (!failedResult || typeof failedResult !== 'object' || Array.isArray(failedResult)) return [];
  return Object.keys(failedResult as Record<string, unknown>);
};

const throwApiError = async (method: string, path: string, response: Response): Promise<never> => {
  const body = await readErrorBody(response);
  const code = body.code ?? `http_${response.status}`;
  const message = body.message ?? body.raw ?? response.statusText;
  throw new DingTalkApiError(`DingTalk API ${method} ${path} failed: ${code} ${message}`, {
    code,
    status: response.status,
  });
};

/**
 * Honour `sessionWebhook` only for https URLs whose host is `oapi.dingtalk.com`
 * or `*.dingtalk.com`. Rejects anything else (SSRF). The URL itself is never
 * included in the thrown message (it carries a `session=` token).
 */
export function assertDingTalkSessionWebhook(webhook: string): void {
  let url: URL;
  try {
    url = new URL(webhook);
  } catch {
    throw new DingTalkApiError('DingTalk sessionWebhook rejected: invalid URL', {
      code: 'invalid_webhook',
    });
  }
  if (url.protocol !== 'https:') {
    throw new DingTalkApiError('DingTalk sessionWebhook rejected: https required', {
      code: 'invalid_webhook',
    });
  }
  const host = url.hostname.toLowerCase();
  const allowed = host === 'oapi.dingtalk.com' || host.endsWith('.dingtalk.com');
  if (!allowed) {
    throw new DingTalkApiError('DingTalk sessionWebhook rejected: host not allowed', {
      code: 'invalid_webhook',
    });
  }
}

export interface DingTalkSendOtoParams {
  msgKey: string;
  msgParam: string;
  robotCode: string;
  userIds: string[];
}

export interface DingTalkSendGroupParams {
  msgKey: string;
  msgParam: string;
  openConversationId: string;
  robotCode: string;
}

export interface DingTalkSendResult {
  processQueryKey?: string;
}

export interface DingTalkRecallMessageParams {
  /** Group open-conversation id. Omit for 1:1 (`otoMessages/batchRecall`). */
  openConversationId?: string;
  processQueryKeys: string[];
  robotCode: string;
}

/**
 * DingTalk robot send responses expose `processQueryKey` (sometimes nested
 * under `result`, sometimes as `processQueryKeys[0]`). Needed to recall.
 */
export const extractProcessQueryKey = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.processQueryKey === 'string' && record.processQueryKey) {
    return record.processQueryKey;
  }
  const keys = record.processQueryKeys;
  if (Array.isArray(keys) && typeof keys[0] === 'string' && keys[0]) {
    return keys[0];
  }
  if (record.result && typeof record.result === 'object') {
    return extractProcessQueryKey(record.result);
  }
  return undefined;
};

export interface DingTalkDownloadFileParams {
  downloadCode: string;
  robotCode: string;
}

export interface DingTalkUploadMediaParams {
  buffer: Buffer;
  filename: string;
  type: 'image' | 'file';
}

/** New-API `oauth2/accessToken` vs legacy oapi `gettoken`. */
export type DingTalkTokenKind = 'accessToken' | 'gettoken';

export interface DingTalkCachedToken {
  expiresAt: number;
  token: string;
}

/**
 * Process- or Redis-backed token store. `ttlMs` is how long the token stays
 * valid (already skew-adjusted by the caller). Implementations must not throw.
 */
export interface DingTalkTokenCache {
  delete?: (kind: DingTalkTokenKind) => Promise<void> | void;
  get: (
    kind: DingTalkTokenKind,
  ) => Promise<DingTalkCachedToken | null> | DingTalkCachedToken | null;
  set: (kind: DingTalkTokenKind, token: string, ttlMs: number) => Promise<void> | void;
}

export interface DingTalkRequestInfo {
  method: string;
  url: string;
}

export interface DingTalkApiClientOptions {
  /** Fired for every HTTP request this client makes. Must not throw. */
  onRequest?: (info: DingTalkRequestInfo) => void;
  /**
   * Dedupes concurrent refreshes for one kind. The server passes a
   * process-wide implementation (in-process promise + Redis NX lock).
   * The map must be filled before the first await so two callers in the
   * same turn share one flight.
   */
  singleFlight?: (kind: DingTalkTokenKind, task: () => Promise<string>) => Promise<string>;
  tokenCache?: DingTalkTokenCache;
}

const safeRequestUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    const query = url.indexOf('?');
    return query >= 0 ? url.slice(0, query) : url;
  }
};

const isInvalidTokenError = (error: unknown): boolean => {
  if (!(error instanceof DingTalkApiError)) return false;
  if (error.code === '40014' || error.code === '401' || error.code === 'http_401') return true;
  return /InvalidAuthentication|InvalidAccessToken|invalid.?token/i.test(error.code);
};

/**
 * Lightweight wrapper around DingTalk Open APIs. All HTTP goes through global
 * `fetch` so Node 24 `HTTP(S)_PROXY` / `NODE_USE_ENV_PROXY` is honoured.
 *
 * New-API token (`oauth2/accessToken`) is cached and refreshed 5 minutes early.
 * Legacy oapi `gettoken` is cached separately for `media/upload`.
 */
export class DingTalkApiClient {
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly options?: DingTalkApiClientOptions;

  private newToken?: TokenCache;
  private legacyToken?: TokenCache;
  private readonly inflight = new Map<DingTalkTokenKind, Promise<string>>();

  constructor(clientId: string, clientSecret: string, options?: DingTalkApiClientOptions) {
    this.appKey = clientId;
    this.appSecret = clientSecret;
    this.options = options;
  }

  async getAccessToken(): Promise<string> {
    return this.resolveToken('accessToken', () => this.fetchAccessToken());
  }

  async getLegacyAccessToken(): Promise<string> {
    return this.resolveToken('gettoken', () => this.fetchLegacyAccessToken());
  }

  /** Drop one cached token so the next call refetches. */
  async invalidateToken(kind: DingTalkTokenKind): Promise<void> {
    if (kind === 'accessToken') this.newToken = undefined;
    else this.legacyToken = undefined;
    try {
      await this.options?.tokenCache?.delete?.(kind);
    } catch {
      // cache errors must not surface on the send path
    }
  }

  async sendBySessionWebhook(webhook: string, payload: Record<string, unknown>): Promise<void> {
    assertDingTalkSessionWebhook(webhook);
    this.noteRequest('POST', webhook);
    const response = await fetch(webhook, {
      body: JSON.stringify(payload),
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
      redirect: 'error',
    });
    if (!response.ok) {
      await throwApiError('POST', 'sessionWebhook', response);
    }

    const raw = await response.text();
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { errcode?: number; errmsg?: string };
      if (data.errcode !== undefined && data.errcode !== 0) {
        throw new DingTalkApiError(
          `DingTalk webhook failed: ${data.errcode} ${data.errmsg ?? ''}`,
          {
            code: String(data.errcode),
          },
        );
      }
    } catch (error) {
      if (error instanceof DingTalkApiError) throw error;
    }
  }

  async sendOtoMessage(params: DingTalkSendOtoParams): Promise<DingTalkSendResult> {
    const data = await this.call('POST', '/v1.0/robot/oToMessages/batchSend', {
      msgKey: params.msgKey,
      msgParam: params.msgParam,
      robotCode: params.robotCode,
      userIds: params.userIds,
    });
    return { processQueryKey: extractProcessQueryKey(data) };
  }

  async sendGroupMessage(params: DingTalkSendGroupParams): Promise<DingTalkSendResult> {
    const data = await this.call('POST', '/v1.0/robot/groupMessages/send', {
      msgKey: params.msgKey,
      msgParam: params.msgParam,
      openConversationId: params.openConversationId,
      robotCode: params.robotCode,
    });
    return { processQueryKey: extractProcessQueryKey(data) };
  }

  /**
   * Recall a previously sent robot message. 1:1 uses
   * `POST /v1.0/robot/otoMessages/batchRecall`; groups use
   * `POST /v1.0/robot/groupMessages/recall`. `processQueryKeys` come from the
   * send response.
   */
  async recallMessage(params: DingTalkRecallMessageParams): Promise<void> {
    const keys = params.processQueryKeys.filter(Boolean);
    if (keys.length === 0) return;

    const data = params.openConversationId
      ? await this.call('POST', '/v1.0/robot/groupMessages/recall', {
          openConversationId: params.openConversationId,
          processQueryKeys: keys,
          robotCode: params.robotCode,
        })
      : await this.call('POST', '/v1.0/robot/otoMessages/batchRecall', {
          processQueryKeys: keys,
          robotCode: params.robotCode,
        });

    const failedKeys = recallFailedResultKeys(data);
    if (failedKeys.length > 0) {
      console.warn('DingTalk recall failedResult keys=%O', failedKeys);
    }
  }

  async downloadMessageFile(params: DingTalkDownloadFileParams): Promise<DingTalkDownloadedFile> {
    const data = (await this.call('POST', '/v1.0/robot/messageFiles/download', {
      downloadCode: params.downloadCode,
      robotCode: params.robotCode,
    })) as { downloadUrl?: string };

    if (!data.downloadUrl) {
      throw new DingTalkApiError('DingTalk downloadMessageFile: missing downloadUrl', {
        code: 'missing_download_url',
      });
    }

    this.noteRequest('GET', data.downloadUrl);
    const fileResponse = await fetch(data.downloadUrl);
    if (!fileResponse.ok) {
      const text = await fileResponse.text();
      throw new DingTalkApiError(
        `DingTalk downloadMessageFile GET failed: ${fileResponse.status} ${text}`,
        { code: `http_${fileResponse.status}`, status: fileResponse.status },
      );
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const filename = parseFilename(fileResponse.headers.get('content-disposition'));
    const mimeType = fileResponse.headers.get('content-type') ?? guessMime(filename);
    return { buffer, filename, mimeType: mimeType ?? undefined };
  }

  async uploadMedia(params: DingTalkUploadMediaParams): Promise<string> {
    try {
      return await this.uploadMediaOnce(params);
    } catch (error) {
      if (!isInvalidTokenError(error)) throw error;
      await this.invalidateToken('gettoken');
      return this.uploadMediaOnce(params);
    }
  }

  async createAndDeliverCard(params: DingTalkCreateCardParams): Promise<unknown> {
    const isGroup = Boolean(params.openConversationId);
    const openSpaceId = isGroup
      ? `dtv1.card//IM_GROUP.${params.openConversationId}`
      : `dtv1.card//IM_ROBOT.${params.staffId}`;

    const body: Record<string, unknown> = {
      cardData: params.cardData ?? { cardParamMap: {} },
      cardTemplateId: params.cardTemplateId,
      openSpaceId,
      outTrackId: params.outTrackId,
    };

    if (isGroup) {
      body.imGroupOpenSpaceModel = { supportForward: true };
      body.imGroupOpenDeliverModel = { robotCode: params.robotCode };
    } else {
      body.imRobotOpenSpaceModel = { supportForward: true };
      body.imRobotOpenDeliverModel = { robotCode: params.robotCode, spaceType: 'IM_ROBOT' };
    }

    try {
      return await this.call('POST', '/v1.0/card/instances', body);
    } catch (error) {
      throw this.wrapCardError('createAndDeliverCard', error);
    }
  }

  async streamCard(params: DingTalkStreamCardParams): Promise<unknown> {
    try {
      return await this.call('PUT', '/v1.0/card/streaming', {
        content: params.content,
        guid: params.guid,
        isFinalize: params.isFinalize ?? false,
        isFull: params.isFull ?? true,
        key: params.key ?? 'content',
        outTrackId: params.outTrackId,
      });
    } catch (error) {
      throw this.wrapCardError('streamCard', error);
    }
  }

  async updateCard(params: DingTalkUpdateCardParams): Promise<unknown> {
    try {
      return await this.call('PUT', '/v1.0/card/instances', {
        cardData: params.cardData ?? { cardParamMap: {} },
        outTrackId: params.outTrackId,
      });
    } catch (error) {
      throw this.wrapCardError('updateCard', error);
    }
  }

  /**
   * Counted JSON call on api.dingtalk.com. Same token, retry, and `onRequest`
   * path as the other OpenAPI methods. Confirm cards use this so create and
   * update are included in the DingTalk call counter.
   */
  async countedRequest(
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.call(method, path, body);
  }

  private wrapCardError(op: string, error: unknown): DingTalkCardUnavailableError {
    if (error instanceof DingTalkCardUnavailableError) return error;
    if (error instanceof DingTalkApiError) {
      return new DingTalkCardUnavailableError(`DingTalk ${op} failed: ${error.message}`, {
        cause: error,
        code: error.code,
        status: error.status,
      });
    }
    return new DingTalkCardUnavailableError(`DingTalk ${op} failed: ${String(error)}`, {
      cause: error,
    });
  }

  private async call(
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.callOnce(method, path, body);
    } catch (error) {
      if (!isInvalidTokenError(error)) throw error;
      await this.invalidateToken('accessToken');
      return this.callOnce(method, path, body);
    }
  }

  private noteRequest(method: string, url: string): void {
    const hook = this.options?.onRequest;
    if (!hook) return;
    try {
      hook({ method, url: safeRequestUrl(url) });
    } catch {
      // counting must never throw or block the request
    }
  }

  private localToken(kind: DingTalkTokenKind): TokenCache | undefined {
    return kind === 'accessToken' ? this.newToken : this.legacyToken;
  }

  private rememberLocal(kind: DingTalkTokenKind, cache: TokenCache | undefined): void {
    if (kind === 'accessToken') this.newToken = cache;
    else this.legacyToken = cache;
  }

  private async readToken(kind: DingTalkTokenKind): Promise<string | null> {
    const now = Date.now();
    const local = this.localToken(kind);
    if (local && now < local.expiresAt) return local.token;
    const cache = this.options?.tokenCache;
    if (!cache) return null;
    try {
      const hit = await cache.get(kind);
      if (!hit || now >= hit.expiresAt || !hit.token) return null;
      this.rememberLocal(kind, { expiresAt: hit.expiresAt, token: hit.token });
      return hit.token;
    } catch {
      return local && now < local.expiresAt ? local.token : null;
    }
  }

  private async storeToken(kind: DingTalkTokenKind, token: string, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) {
      this.rememberLocal(kind, undefined);
      return;
    }
    const stored = { expiresAt: Date.now() + ttlMs, token };
    this.rememberLocal(kind, stored);
    try {
      await this.options?.tokenCache?.set(kind, token, ttlMs);
    } catch {
      // Redis down: the in-instance cache above still serves this process.
    }
  }

  private resolveToken(
    kind: DingTalkTokenKind,
    fetchFresh: () => Promise<{ token: string; ttlMs: number }>,
  ): Promise<string> {
    const pending = this.inflight.get(kind);
    if (pending) return pending;
    const load = async (): Promise<string> => {
      const hit = await this.readToken(kind);
      if (hit) return hit;
      const run = async (): Promise<string> => {
        const again = await this.readToken(kind);
        if (again) return again;
        const fresh = await fetchFresh();
        await this.storeToken(kind, fresh.token, fresh.ttlMs);
        return fresh.token;
      };
      if (this.options?.singleFlight) return this.options.singleFlight(kind, run);
      return run();
    };
    const promise = load().finally(() => {
      if (this.inflight.get(kind) === promise) this.inflight.delete(kind);
    });
    this.inflight.set(kind, promise);
    return promise;
  }

  private async fetchAccessToken(): Promise<{ token: string; ttlMs: number }> {
    const url = `${DINGTALK_API_BASE}/v1.0/oauth2/accessToken`;
    this.noteRequest('POST', url);
    const response = await fetch(url, {
      body: JSON.stringify({ appKey: this.appKey, appSecret: this.appSecret }),
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      await throwApiError('POST', '/v1.0/oauth2/accessToken', response);
    }

    const data = (await response.json()) as { accessToken?: string; expireIn?: number };
    if (!data.accessToken) {
      throw new DingTalkApiError('DingTalk auth error: missing accessToken', {
        code: 'missing_token',
      });
    }

    const expireInSec = data.expireIn ?? 7200;
    return { token: data.accessToken, ttlMs: expireInSec * 1000 - TOKEN_REFRESH_SKEW_MS };
  }

  private async fetchLegacyAccessToken(): Promise<{ token: string; ttlMs: number }> {
    const url = new URL(`${DINGTALK_OAPI_BASE}/gettoken`);
    url.searchParams.set('appkey', this.appKey);
    url.searchParams.set('appsecret', this.appSecret);
    this.noteRequest('GET', `${DINGTALK_OAPI_BASE}/gettoken`);

    const response = await fetch(url, { headers: { Accept: 'application/json' }, method: 'GET' });
    const data = (await response.json()) as {
      access_token?: string;
      errcode?: number;
      errmsg?: string;
      expires_in?: number;
    };

    if (!response.ok || (data.errcode !== undefined && data.errcode !== 0) || !data.access_token) {
      throw new DingTalkApiError(
        `DingTalk legacy auth failed: ${data.errcode ?? response.status} ${data.errmsg ?? ''}`,
        { code: String(data.errcode ?? `http_${response.status}`), status: response.status },
      );
    }

    const expireInSec = data.expires_in ?? 7200;
    return { token: data.access_token, ttlMs: expireInSec * 1000 - TOKEN_REFRESH_SKEW_MS };
  }

  private async uploadMediaOnce(params: DingTalkUploadMediaParams): Promise<string> {
    const token = await this.getLegacyAccessToken();
    const url = `${DINGTALK_OAPI_BASE}/media/upload?access_token=${encodeURIComponent(token)}&type=${params.type}`;
    this.noteRequest('POST', `${DINGTALK_OAPI_BASE}/media/upload`);
    const form = new FormData();
    form.append('type', params.type);
    form.append(
      'media',
      new Blob([new Uint8Array(params.buffer)], { type: 'application/octet-stream' }),
      params.filename,
    );

    const response = await fetch(url, { body: form, method: 'POST' });
    const data = (await response.json()) as {
      errcode?: number;
      errmsg?: string;
      media_id?: string;
    };

    if (!response.ok || (data.errcode !== undefined && data.errcode !== 0) || !data.media_id) {
      throw new DingTalkApiError(
        `DingTalk media/upload failed: ${data.errcode ?? response.status} ${data.errmsg ?? ''}`,
        { code: String(data.errcode ?? `http_${response.status}`), status: response.status },
      );
    }

    return data.media_id;
  }

  private async callOnce(
    method: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const token = await this.getAccessToken();
    const url = `${DINGTALK_API_BASE}${path}`;
    this.noteRequest(method, url);
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': token,
      },
      method,
    });

    if (!response.ok) {
      await throwApiError(method, path, response);
    }

    const raw = await response.text();
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.code !== undefined && data.code !== '0' && data.code !== 0) {
      throw new DingTalkApiError(
        `DingTalk API ${method} ${path} failed: ${String(data.code)} ${String(data.message ?? '')}`,
        { code: String(data.code) },
      );
    }
    return data;
  }
}
