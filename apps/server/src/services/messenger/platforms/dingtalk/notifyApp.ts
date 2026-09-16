import { isRecord, pickTrimmedString } from '@lobechat/utils/object';
import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';
import { pinyinFieldsFromFullName } from '@/database/utils/pinyin';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:messenger:dingtalk:notify-app');

export const DINGTALK_OAPI_BASE = 'https://oapi.dingtalk.com';
export const DINGTALK_OAPI_GETTOKEN_URL = `${DINGTALK_OAPI_BASE}/gettoken`;
export const DINGTALK_ASYNCSEND_V2_URL = `${DINGTALK_OAPI_BASE}/topapi/message/corpconversation/asyncsend_v2`;
export const DINGTALK_DEPT_LISTSUB_URL = `${DINGTALK_OAPI_BASE}/topapi/v2/department/listsub`;
export const DINGTALK_DEPT_GET_URL = `${DINGTALK_OAPI_BASE}/topapi/v2/department/get`;
export const DINGTALK_USER_LIST_URL = `${DINGTALK_OAPI_BASE}/topapi/v2/user/list`;

export const DINGTALK_NOTIFY_TOKEN_REDIS_KEY = 'messenger:dingtalk:notify-token';
/** ~100 min in-memory + Redis cache (DingTalk tokens last 7200 s). */
export const DINGTALK_NOTIFY_TOKEN_CACHE_MS = 100 * 60 * 1000;
export const DINGTALK_WORK_NOTICE_USERID_CHUNK = 100;
export const DINGTALK_USER_LIST_PAGE_SIZE = 100;
export const DINGTALK_DIRECTORY_ROOT_DEPT_ID = '1';
export const DINGTALK_NOTIFY_APP_FETCH_TIMEOUT_MS = 15_000;

export type DingTalkNotifyFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'json' | 'status' | 'text'>>;

export interface DingTalkNotifyAppConfig {
  agentId: string;
  appKey: string;
  appSecret: string;
}

export interface DingTalkWorkNoticeMarkdown {
  text: string;
  title: string;
}

export interface DingTalkWorkNoticeActionCard {
  markdown: string;
  singleTitle: string;
  singleUrl: string;
  title: string;
}

export type SendWorkNoticeInput =
  | { actionCard: DingTalkWorkNoticeActionCard; staffIds: string[] }
  | { markdown: DingTalkWorkNoticeMarkdown; staffIds: string[] };

export interface SendWorkNoticeResult {
  taskId: string;
}

export interface DingTalkDirectoryDepartmentInput {
  deptId: string;
  memberCount: number;
  name: string;
  namePinyinFull: string;
  namePinyinInitials: string;
  parentId: string | null;
  pathNames: string;
  sortOrder: number;
  syncedAt: Date;
}

export interface DingTalkDirectoryUserInput {
  active: boolean;
  avatar: string | null;
  deptPath: string;
  leafDeptId: string | null;
  leafDeptName: string;
  name: string;
  namePinyinFull: string;
  namePinyinInitials: string;
  staffId: string;
  syncedAt: Date;
  unionId: string | null;
}

export interface DingTalkDirectoryMembershipInput {
  deptId: string;
  staffId: string;
}

export interface DingTalkDirectoryReplaceAllInput {
  departments: DingTalkDirectoryDepartmentInput[];
  memberships: DingTalkDirectoryMembershipInput[];
  users: DingTalkDirectoryUserInput[];
}

export interface DingTalkRawDepartment {
  deptId: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
}

export interface DingTalkRawDeptUser {
  active: boolean;
  avatar: string | null;
  deptIds: string[];
  name: string;
  staffId: string;
  unionId: string | null;
}

export class DingTalkNotifyAppError extends Error {
  readonly errcode: string | number | null;
  readonly errmsg: string | null;

  constructor(message: string, errcode?: string | number | null, errmsg?: string | null) {
    super(message);
    this.name = 'DingTalkNotifyAppError';
    this.errcode = errcode ?? null;
    this.errmsg = errmsg ?? null;
  }
}

interface NotifyTokenCache {
  appKey: string;
  expiresAt: number;
  token: string;
}

let memoryToken: NotifyTokenCache | null = null;

export const resetNotifyAppStateForTest = (): void => {
  memoryToken = null;
};

const emptyToNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asDeptId = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return emptyToNull(typeof value === 'string' ? value : null);
};

const asParentDeptId = (value: unknown): string | null => {
  const id = asDeptId(value);
  if (!id || id === '0') return null;
  return id;
};

const httpsImage = (value: unknown): string | null => {
  const trimmed = pickTrimmedString(value);
  if (!trimmed?.startsWith('https://')) return null;
  return trimmed;
};

const isDingTalkErrcodeFailure = (errcode: unknown): boolean =>
  errcode !== 0 && errcode !== undefined && errcode !== null && errcode !== '0';

const clipMessage = (value: string | undefined, max = 500): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

const notifyAppFromRecord = (value: unknown): DingTalkNotifyAppConfig | null => {
  if (!isRecord(value)) return null;
  const appKey = pickTrimmedString(value.appKey);
  const appSecret = pickTrimmedString(value.appSecret);
  const agentId =
    pickTrimmedString(value.agentId) ??
    (typeof value.agentId === 'number' && Number.isFinite(value.agentId)
      ? String(value.agentId)
      : undefined);
  if (!appKey || !appSecret || !agentId) return null;
  return { agentId, appKey, appSecret };
};

/** R1a: `getMessengerDingTalkConfig().notifyApp` — null unless all three fields are present. */
export const readNotifyAppFromMessengerConfig = (
  config: unknown,
): DingTalkNotifyAppConfig | null => {
  if (!isRecord(config)) return null;
  return notifyAppFromRecord(config.notifyApp);
};

/** Stored `system_bot_providers` row: settings.notifyAppKey / notifyAgentId + credentials.notifyAppSecret. */
export const readNotifyAppFromProviderRow = (row: {
  credentials?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
}): DingTalkNotifyAppConfig | null => {
  const settings = isRecord(row.settings) ? row.settings : {};
  const credentials = isRecord(row.credentials) ? row.credentials : {};
  return notifyAppFromRecord({
    agentId: settings.notifyAgentId,
    appKey: settings.notifyAppKey,
    appSecret: credentials.notifyAppSecret,
  });
};

export const resolveNotifyAppConfig = async (): Promise<DingTalkNotifyAppConfig | null> => {
  const config = await getMessengerDingTalkConfig();
  return readNotifyAppFromMessengerConfig(config);
};

const doFetch: DingTalkNotifyFetch = (input, init) => globalThis.fetch(input, init);

const withTimeout = (timeoutMs: number): { abort: () => void; signal: AbortSignal } => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    abort: () => clearTimeout(timer),
    signal: controller.signal,
  };
};

const parseJson = async (response: Pick<Response, 'json'>): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    log('invalid json: %O', error);
    return null;
  }
};

const errcodeFromRecord = (record: Record<string, unknown> | null): string | number | null => {
  if (!record) return null;
  const value = record.errcode ?? record.code;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return null;
};

const errmsgFromRecord = (record: Record<string, unknown> | null): string | null => {
  if (!record) return null;
  return (
    clipMessage(pickTrimmedString(record.errmsg)) ??
    clipMessage(pickTrimmedString(record.message)) ??
    clipMessage(pickTrimmedString(record.msg))
  );
};

const throwIfOapiFailed = (
  method: string,
  responseOk: boolean,
  status: number,
  body: unknown,
): Record<string, unknown> => {
  const record = isRecord(body) ? body : null;
  const errcode = errcodeFromRecord(record);
  const errmsg = errmsgFromRecord(record);
  if (!responseOk || isDingTalkErrcodeFailure(errcode)) {
    throw new DingTalkNotifyAppError(
      `DingTalk ${method} failed: ${errcode ?? `http_${status}`} ${errmsg ?? ''}`.trim(),
      errcode,
      errmsg,
    );
  }
  return record ?? {};
};

const fetchOapiGettoken = async (
  appKey: string,
  appSecret: string,
  fetchImpl: DingTalkNotifyFetch,
  now: number,
): Promise<{ expiresAt: number; token: string }> => {
  const url = new URL(DINGTALK_OAPI_GETTOKEN_URL);
  url.searchParams.set('appkey', appKey);
  url.searchParams.set('appsecret', appSecret);
  const timeout = withTimeout(DINGTALK_NOTIFY_APP_FETCH_TIMEOUT_MS);

  let response: Pick<Response, 'ok' | 'json' | 'status'>;
  try {
    response = await fetchImpl(url.toString(), {
      cache: 'no-store',
      method: 'GET',
      redirect: 'error',
      signal: timeout.signal,
    });
  } catch (error) {
    timeout.abort();
    if (error instanceof DingTalkNotifyAppError) throw error;
    throw new DingTalkNotifyAppError(
      `DingTalk gettoken network error: ${error instanceof Error ? error.message : String(error)}`,
      'network',
      error instanceof Error ? error.message : 'network error',
    );
  } finally {
    timeout.abort();
  }

  const body = await parseJson(response);
  const record = throwIfOapiFailed('gettoken', response.ok, response.status, body);
  const token = pickTrimmedString(record.access_token);
  if (!token) {
    throw new DingTalkNotifyAppError('DingTalk gettoken missing access_token', 'missing_token');
  }

  const expiresIn =
    typeof record.expires_in === 'number' && Number.isFinite(record.expires_in)
      ? record.expires_in
      : 7200;
  const ttlMs = Math.min(
    DINGTALK_NOTIFY_TOKEN_CACHE_MS,
    Math.max(0, expiresIn * 1000 - 5 * 60_000),
  );
  return { expiresAt: now + ttlMs, token };
};

const readRedisToken = async (appKey: string, now: number): Promise<string | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(DINGTALK_NOTIFY_TOKEN_REDIS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    if (pickTrimmedString(parsed.appKey) !== appKey) return null;
    const token = pickTrimmedString(parsed.token);
    const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0;
    if (!token || expiresAt <= now) return null;
    return token;
  } catch (error) {
    log('readRedisToken failed: %O', error);
    return null;
  }
};

const writeRedisToken = async (cache: NotifyTokenCache, now: number): Promise<void> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  const ttlSeconds = Math.max(1, Math.floor((cache.expiresAt - now) / 1000));
  try {
    await redis.set(
      DINGTALK_NOTIFY_TOKEN_REDIS_KEY,
      JSON.stringify({ appKey: cache.appKey, expiresAt: cache.expiresAt, token: cache.token }),
      'EX',
      ttlSeconds,
    );
  } catch (error) {
    log('writeRedisToken failed: %O', error);
  }
};

export const getNotifyAppToken = async (params?: {
  config?: DingTalkNotifyAppConfig | null;
  fetchImpl?: DingTalkNotifyFetch;
  now?: number;
  skipCache?: boolean;
}): Promise<string> => {
  const config = params?.config === undefined ? await resolveNotifyAppConfig() : params.config;
  if (!config) {
    throw new DingTalkNotifyAppError(
      'DingTalk notify app is not configured',
      'notify_app_not_configured',
    );
  }

  const now = params?.now ?? Date.now();
  const fetchImpl = params?.fetchImpl ?? doFetch;

  if (!params?.skipCache) {
    if (memoryToken && memoryToken.appKey === config.appKey && memoryToken.expiresAt > now) {
      return memoryToken.token;
    }
    const redisToken = await readRedisToken(config.appKey, now);
    if (redisToken) {
      memoryToken = {
        appKey: config.appKey,
        expiresAt: now + DINGTALK_NOTIFY_TOKEN_CACHE_MS,
        token: redisToken,
      };
      return redisToken;
    }
  }

  const fetched = await fetchOapiGettoken(config.appKey, config.appSecret, fetchImpl, now);
  memoryToken = { appKey: config.appKey, expiresAt: fetched.expiresAt, token: fetched.token };
  await writeRedisToken(memoryToken, now);
  return fetched.token;
};

export type NotifyAppProbeErrorCode = 'auth_failed' | 'missing_credentials' | 'network' | 'unknown';

export interface NotifyAppTokenProbeResult {
  errorCode: NotifyAppProbeErrorCode | null;
  errorMessage: string | null;
  latencyMs: number | null;
  ok: boolean;
  robotName: null;
}

const AUTH_FAILED_PATTERN =
  /idorsecret|appkey|appsecret|invalidauthentication|invalidclient|invalid.*secret|invalid.*key/i;

export const probeNotifyAppToken = async (params: {
  appKey: string;
  appSecret: string;
  fetchImpl?: DingTalkNotifyFetch;
}): Promise<NotifyAppTokenProbeResult> => {
  const startedAt = performance.now();
  try {
    await getNotifyAppToken({
      config: { agentId: '0', appKey: params.appKey, appSecret: params.appSecret },
      fetchImpl: params.fetchImpl,
      skipCache: true,
    });
    return {
      errorCode: null,
      errorMessage: null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ok: true,
      robotName: null,
    };
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (error instanceof DingTalkNotifyAppError) {
      const detail = `${error.errcode ?? ''} ${error.errmsg ?? error.message}`;
      const errorCode: NotifyAppProbeErrorCode =
        error.errcode === 'network'
          ? 'network'
          : AUTH_FAILED_PATTERN.test(detail)
            ? 'auth_failed'
            : 'unknown';
      return {
        errorCode,
        errorMessage: clipMessage(error.errmsg ?? error.message),
        latencyMs,
        ok: false,
        robotName: null,
      };
    }
    return {
      errorCode: 'network',
      errorMessage: clipMessage(error instanceof Error ? error.message : 'network error'),
      latencyMs,
      ok: false,
      robotName: null,
    };
  }
};

const oapiPost = async (
  url: string,
  accessToken: string,
  body: Record<string, unknown>,
  fetchImpl: DingTalkNotifyFetch,
): Promise<Record<string, unknown>> => {
  const endpoint = new URL(url);
  endpoint.searchParams.set('access_token', accessToken);
  const timeout = withTimeout(DINGTALK_NOTIFY_APP_FETCH_TIMEOUT_MS);

  let response: Pick<Response, 'ok' | 'json' | 'status'>;
  try {
    response = await fetchImpl(endpoint.toString(), {
      body: JSON.stringify(body),
      cache: 'no-store',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
      redirect: 'error',
      signal: timeout.signal,
    });
  } catch (error) {
    timeout.abort();
    if (error instanceof DingTalkNotifyAppError) throw error;
    throw new DingTalkNotifyAppError(
      `DingTalk POST ${url} network error: ${error instanceof Error ? error.message : String(error)}`,
      'network',
      error instanceof Error ? error.message : 'network error',
    );
  } finally {
    timeout.abort();
  }

  const parsed = await parseJson(response);
  return throwIfOapiFailed(url, response.ok, response.status, parsed);
};

const parseAgentId = (agentId: string): number => {
  const numeric = Number(agentId);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new DingTalkNotifyAppError(
      `DingTalk notify agentId is invalid: ${agentId}`,
      'invalid_agent_id',
    );
  }
  return numeric;
};

const uniqueStaffIds = (staffIds: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of staffIds) {
    const id = emptyToNull(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
};

const chunkIds = (ids: string[], size: number): string[][] => {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
};

const buildWorkNoticeMsg = (input: SendWorkNoticeInput): Record<string, unknown> => {
  if ('actionCard' in input) {
    const { actionCard } = input;
    return {
      action_card: {
        markdown: actionCard.markdown,
        single_title: actionCard.singleTitle,
        single_url: actionCard.singleUrl,
        title: actionCard.title,
      },
      msgtype: 'action_card',
    };
  }
  return {
    markdown: { text: input.markdown.text, title: input.markdown.title },
    msgtype: 'markdown',
  };
};

export const sendWorkNotice = async (
  input: SendWorkNoticeInput,
  params?: {
    config?: DingTalkNotifyAppConfig | null;
    fetchImpl?: DingTalkNotifyFetch;
  },
): Promise<SendWorkNoticeResult[]> => {
  const config = params?.config === undefined ? await resolveNotifyAppConfig() : params.config;
  if (!config) {
    throw new DingTalkNotifyAppError(
      'DingTalk notify app is not configured',
      'notify_app_not_configured',
    );
  }

  const staffIds = uniqueStaffIds(input.staffIds);
  if (staffIds.length === 0) return [];

  const fetchImpl = params?.fetchImpl ?? doFetch;
  const token = await getNotifyAppToken({ config, fetchImpl });
  const agentId = parseAgentId(config.agentId);
  const msg = buildWorkNoticeMsg(input);
  const results: SendWorkNoticeResult[] = [];

  for (const chunk of chunkIds(staffIds, DINGTALK_WORK_NOTICE_USERID_CHUNK)) {
    const record = await oapiPost(
      DINGTALK_ASYNCSEND_V2_URL,
      token,
      {
        agent_id: agentId,
        msg,
        userid_list: chunk.join(','),
      },
      fetchImpl,
    );
    const taskIdRaw = record.task_id ?? record.taskId;
    const taskId =
      typeof taskIdRaw === 'number' && Number.isFinite(taskIdRaw)
        ? String(taskIdRaw)
        : pickTrimmedString(taskIdRaw);
    if (!taskId) {
      throw new DingTalkNotifyAppError('DingTalk asyncsend_v2 missing task_id', 'missing_task_id');
    }
    results.push({ taskId });
  }

  return results;
};

const mapDepartmentRecord = (value: unknown): DingTalkRawDepartment | null => {
  if (!isRecord(value)) return null;
  const deptId = asDeptId(value.dept_id ?? value.deptId);
  const name = pickTrimmedString(value.name);
  if (!deptId || !name) return null;
  const sortOrder =
    typeof value.order === 'number' && Number.isFinite(value.order)
      ? value.order
      : typeof value.sort_order === 'number' && Number.isFinite(value.sort_order)
        ? value.sort_order
        : 0;
  return {
    deptId,
    name,
    parentId: asParentDeptId(value.parent_id ?? value.parentId),
    sortOrder,
  };
};

const mapDeptUserRecord = (value: unknown): DingTalkRawDeptUser | null => {
  if (!isRecord(value)) return null;
  const staffId = pickTrimmedString(value.userid) ?? pickTrimmedString(value.userId);
  const name = pickTrimmedString(value.name) ?? staffId;
  if (!staffId || !name) return null;
  const deptIdsRaw = Array.isArray(value.dept_id_list)
    ? value.dept_id_list
    : Array.isArray(value.deptIdList)
      ? value.deptIdList
      : [];
  const deptIds = deptIdsRaw
    .map((item) => asDeptId(item))
    .filter((id): id is string => Boolean(id));
  return {
    active: value.active !== false,
    avatar: httpsImage(value.avatar),
    deptIds,
    name,
    staffId,
    unionId: pickTrimmedString(value.unionid) ?? pickTrimmedString(value.unionId) ?? null,
  };
};

export const listDepartments = async (params?: {
  config?: DingTalkNotifyAppConfig | null;
  fetchImpl?: DingTalkNotifyFetch;
}): Promise<DingTalkRawDepartment[]> => {
  const config = params?.config === undefined ? await resolveNotifyAppConfig() : params.config;
  if (!config) {
    throw new DingTalkNotifyAppError(
      'DingTalk notify app is not configured',
      'notify_app_not_configured',
    );
  }
  const fetchImpl = params?.fetchImpl ?? doFetch;
  const token = await getNotifyAppToken({ config, fetchImpl });

  const rootRecord = await oapiPost(
    DINGTALK_DEPT_GET_URL,
    token,
    { dept_id: Number(DINGTALK_DIRECTORY_ROOT_DEPT_ID), language: 'zh_CN' },
    fetchImpl,
  );
  const root = mapDepartmentRecord(rootRecord.result) ?? {
    deptId: DINGTALK_DIRECTORY_ROOT_DEPT_ID,
    name: 'root',
    parentId: null,
    sortOrder: 0,
  };
  if (root.deptId === DINGTALK_DIRECTORY_ROOT_DEPT_ID) root.parentId = null;

  const departments: DingTalkRawDepartment[] = [root];
  const queue = [root.deptId];
  const seen = new Set<string>([root.deptId]);

  while (queue.length > 0) {
    const deptId = queue.shift()!;
    const record = await oapiPost(
      DINGTALK_DEPT_LISTSUB_URL,
      token,
      { dept_id: Number(deptId) },
      fetchImpl,
    );
    const children = Array.isArray(record.result) ? record.result : [];
    for (const child of children) {
      const mapped = mapDepartmentRecord(child);
      if (!mapped || seen.has(mapped.deptId)) continue;
      seen.add(mapped.deptId);
      departments.push(mapped);
      queue.push(mapped.deptId);
    }
  }

  return departments;
};

export const listDeptUsers = async (
  deptId: string,
  params?: {
    config?: DingTalkNotifyAppConfig | null;
    fetchImpl?: DingTalkNotifyFetch;
  },
): Promise<DingTalkRawDeptUser[]> => {
  const config = params?.config === undefined ? await resolveNotifyAppConfig() : params.config;
  if (!config) {
    throw new DingTalkNotifyAppError(
      'DingTalk notify app is not configured',
      'notify_app_not_configured',
    );
  }
  const fetchImpl = params?.fetchImpl ?? doFetch;
  const token = await getNotifyAppToken({ config, fetchImpl });
  const users: DingTalkRawDeptUser[] = [];
  let cursor = 0;

  for (;;) {
    const record = await oapiPost(
      DINGTALK_USER_LIST_URL,
      token,
      {
        cursor,
        dept_id: Number(deptId),
        language: 'zh_CN',
        size: DINGTALK_USER_LIST_PAGE_SIZE,
      },
      fetchImpl,
    );
    const result = isRecord(record.result) ? record.result : {};
    const list = Array.isArray(result.list) ? result.list : [];
    for (const item of list) {
      const mapped = mapDeptUserRecord(item);
      if (mapped) users.push(mapped);
    }
    const hasMore = result.has_more === true;
    const nextCursor =
      typeof result.next_cursor === 'number' ? result.next_cursor : Number(result.next_cursor);
    if (!hasMore || !Number.isFinite(nextCursor)) break;
    cursor = nextCursor;
  }

  return users;
};

const PATH_JOINER = ' / ';

export const computeDepartmentPathNames = (
  departments: readonly DingTalkRawDepartment[],
): Map<string, string> => {
  const byId = new Map(departments.map((dept) => [dept.deptId, dept]));
  const paths = new Map<string, string>();

  const pathFor = (deptId: string, stack: Set<string>): string => {
    const cached = paths.get(deptId);
    if (cached !== undefined) return cached;
    if (stack.has(deptId)) return '';
    const dept = byId.get(deptId);
    if (!dept) return '';
    stack.add(deptId);
    const parentPath = dept.parentId ? pathFor(dept.parentId, stack) : '';
    stack.delete(deptId);
    const self = dept.deptId === DINGTALK_DIRECTORY_ROOT_DEPT_ID ? '' : dept.name;
    const path = [parentPath, self].filter(Boolean).join(PATH_JOINER);
    paths.set(deptId, path);
    return path;
  };

  for (const dept of departments) pathFor(dept.deptId, new Set());
  return paths;
};

const pickLeafDepartment = (
  deptIds: string[],
  pathByDept: Map<string, string>,
  nameByDept: Map<string, string>,
): { leafDeptId: string | null; leafDeptName: string; deptPath: string } => {
  let bestId: string | null = null;
  let bestPath = '';
  for (const deptId of deptIds) {
    const path = pathByDept.get(deptId) ?? '';
    if (!bestId || path.length > bestPath.length) {
      bestId = deptId;
      bestPath = path;
    }
  }
  return {
    deptPath: bestPath,
    leafDeptId: bestId,
    leafDeptName: bestId ? (nameByDept.get(bestId) ?? '') : '',
  };
};

export const buildDirectoryReplaceAllInput = (params: {
  departments: DingTalkRawDepartment[];
  memberships?: Array<{ deptId: string; staffId: string }>;
  now?: Date;
  usersByDept: Array<{ deptId: string; users: DingTalkRawDeptUser[] }>;
}): DingTalkDirectoryReplaceAllInput => {
  const syncedAt = params.now ?? new Date();
  const pathByDept = computeDepartmentPathNames(params.departments);
  const nameByDept = new Map(params.departments.map((dept) => [dept.deptId, dept.name]));
  const knownDepts = new Set(params.departments.map((dept) => dept.deptId));
  const memberCount = new Map<string, number>();
  const usersById = new Map<string, DingTalkRawDeptUser>();
  const membershipKeys = new Set<string>();
  const memberships: DingTalkDirectoryMembershipInput[] = [];

  const addMembership = (staffId: string, deptId: string) => {
    if (!knownDepts.has(deptId)) return;
    const key = `${staffId}\0${deptId}`;
    if (membershipKeys.has(key)) return;
    membershipKeys.add(key);
    memberships.push({ deptId, staffId });
  };

  for (const group of params.usersByDept) {
    memberCount.set(group.deptId, group.users.length);
    for (const user of group.users) {
      const existing = usersById.get(user.staffId);
      usersById.set(
        user.staffId,
        existing
          ? { ...existing, ...user, deptIds: [...new Set([...existing.deptIds, ...user.deptIds])] }
          : user,
      );
      addMembership(user.staffId, group.deptId);
      for (const extra of user.deptIds) addMembership(user.staffId, extra);
    }
  }

  for (const extra of params.memberships ?? []) addMembership(extra.staffId, extra.deptId);

  const departments = params.departments.map((dept) => {
    const pinyin = pinyinFieldsFromFullName(dept.name);
    return {
      deptId: dept.deptId,
      memberCount: memberCount.get(dept.deptId) ?? 0,
      name: dept.name,
      namePinyinFull: pinyin.pinyinFull ?? '',
      namePinyinInitials: pinyin.pinyinInitials ?? '',
      parentId: dept.deptId === DINGTALK_DIRECTORY_ROOT_DEPT_ID ? null : dept.parentId,
      pathNames: pathByDept.get(dept.deptId) ?? '',
      sortOrder: dept.sortOrder,
      syncedAt,
    };
  });

  const users: DingTalkDirectoryUserInput[] = [...usersById.values()].map((user) => {
    const pinyin = pinyinFieldsFromFullName(user.name);
    const userDeptIds = memberships
      .filter((row) => row.staffId === user.staffId)
      .map((row) => row.deptId);
    const leaf = pickLeafDepartment(userDeptIds, pathByDept, nameByDept);
    return {
      active: user.active,
      avatar: user.avatar,
      deptPath: leaf.deptPath,
      leafDeptId: leaf.leafDeptId,
      leafDeptName: leaf.leafDeptName,
      name: user.name,
      namePinyinFull: pinyin.pinyinFull ?? '',
      namePinyinInitials: pinyin.pinyinInitials ?? '',
      staffId: user.staffId,
      syncedAt,
      unionId: user.unionId,
    };
  });

  return { departments, memberships, users };
};

export const fetchDirectoryReplaceAllInput = async (params?: {
  config?: DingTalkNotifyAppConfig | null;
  fetchImpl?: DingTalkNotifyFetch;
  now?: Date;
}): Promise<DingTalkDirectoryReplaceAllInput> => {
  const config = params?.config === undefined ? await resolveNotifyAppConfig() : params.config;
  if (!config) {
    throw new DingTalkNotifyAppError(
      'DingTalk notify app is not configured',
      'notify_app_not_configured',
    );
  }
  const fetchImpl = params?.fetchImpl ?? doFetch;
  const departments = await listDepartments({ config, fetchImpl });
  const usersByDept: Array<{ deptId: string; users: DingTalkRawDeptUser[] }> = [];
  for (const dept of departments) {
    const users = await listDeptUsers(dept.deptId, { config, fetchImpl });
    usersByDept.push({ deptId: dept.deptId, users });
  }
  return buildDirectoryReplaceAllInput({ departments, now: params?.now, usersByDept });
};
