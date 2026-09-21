import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:dingtalk-workspace:api-call-stats');

export const DINGTALK_API_CALL_STATS_TIMEZONE = 'Asia/Shanghai';
export const DINGTALK_API_CALL_STATS_KEY_PREFIX = 'dingtalk:api-calls:';
export const DINGTALK_API_CALL_STATS_TTL_SECONDS = 40 * 24 * 60 * 60;
export const DINGTALK_API_CALL_STATS_DEFAULT_DAYS = 30;
export const DINGTALK_API_CALL_STATS_MAX_DAYS = 40;
/** Belt cap on unique in-process API fields per Shanghai day. */
export const DINGTALK_API_CALL_STATS_MAX_APIS_PER_DAY = 256;

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_SEGMENT = /^\d{5,}$/;
// Case-sensitive `PROC` + `-`/`_` so `processes` / `processInstances` stay as-is.
const PROCESS_CODE_SEGMENT = /^PROC[-_]\w+$/;
const HEX_SEGMENT = /^[0-9a-f]{16,}$/i;
const BASE64URL_SEGMENT = /^[\w-]{16,}$/;
const TASK_OR_DING_ID_SEGMENT = /^(?:task|ding)[\w-]{12,}$/i;

const hasDigit = (segment: string): boolean => /\d/.test(segment);
const hasHyphenOrUnderscore = (segment: string): boolean => /[-_]/.test(segment);
const isMixedCaseWithDigit = (segment: string): boolean =>
  /[A-Z]/.test(segment) && /[a-z]/.test(segment) && hasDigit(segment);

export const dingtalkApiCallStatsRedisKey = (date: string): string =>
  `${DINGTALK_API_CALL_STATS_KEY_PREFIX}${date}`;

export const formatDingtalkApiCallStatsDate = (date: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: DINGTALK_API_CALL_STATS_TIMEZONE,
    year: 'numeric',
  }).format(date);

const lastNDaysOldestFirst = (n: number, now: Date): string[] => {
  const today = formatDingtalkApiCallStatsDate(now);
  const [year, month, day] = today.split('-').map(Number);
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const cursor = new Date(utcNoon - i * 86_400_000);
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cursor.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
  }
  return dates;
};

const pathnameOf = (urlOrPath: string): string => {
  const trimmed = urlOrPath.trim();
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).pathname || '/';
    }
  } catch {
    // fall through to query-strip
  }
  const q = trimmed.indexOf('?');
  const path = q >= 0 ? trimmed.slice(0, q) : trimmed;
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
};

const isIdSegment = (segment: string): boolean => {
  if (segment.includes('=')) return true;
  if (UUID_SEGMENT.test(segment)) return true;
  if (NUMERIC_ID_SEGMENT.test(segment)) return true;
  if (PROCESS_CODE_SEGMENT.test(segment)) return true;
  if (TASK_OR_DING_ID_SEGMENT.test(segment)) return true;
  if (HEX_SEGMENT.test(segment)) return true;
  if (BASE64URL_SEGMENT.test(segment) && (hasDigit(segment) || hasHyphenOrUnderscore(segment))) {
    return true;
  }
  return segment.length >= 20 && isMixedCaseWithDigit(segment);
};

/**
 * `'<METHOD> <path template>'`. Query strings are dropped. Only path segments
 * that look like identifiers become `:id` — never camelCase/lowercase API words
 * such as `processes` or `processInstances`.
 */
export const toDingtalkApiCallKey = (method: string, urlOrPath: string): string => {
  const pathname = pathnameOf(urlOrPath);
  const parts = pathname.split('/').filter((part) => part.length > 0);
  const templated = parts.map((segment) => (isIdSegment(segment) ? ':id' : segment));
  return `${method.toUpperCase()} /${templated.join('/')}`;
};

export interface DingtalkApiCallStatsByApi {
  api: string;
  count: number;
}

export interface DingtalkApiCallStatsDay {
  byApi: DingtalkApiCallStatsByApi[];
  date: string;
  total: number;
}

export interface DingtalkApiCallStats {
  days: DingtalkApiCallStatsDay[];
  total: number;
}

const memoryCounts = new Map<string, Map<string, number>>();

const capInnerMemoryCounts = (byApi: Map<string, number>, keepApiKey: string): void => {
  if (byApi.size <= DINGTALK_API_CALL_STATS_MAX_APIS_PER_DAY) return;
  for (const key of byApi.keys()) {
    if (key === keepApiKey) continue;
    byApi.delete(key);
    if (byApi.size <= DINGTALK_API_CALL_STATS_MAX_APIS_PER_DAY) return;
  }
};

const evictStaleMemoryCounts = (now: Date): void => {
  const keep = new Set(lastNDaysOldestFirst(DINGTALK_API_CALL_STATS_MAX_DAYS, now));
  for (const date of memoryCounts.keys()) {
    if (!keep.has(date)) memoryCounts.delete(date);
  }
};

const incrementMemory = (date: string, apiKey: string, now: Date): void => {
  let byApi = memoryCounts.get(date);
  if (!byApi) {
    byApi = new Map();
    memoryCounts.set(date, byApi);
  }
  byApi.set(apiKey, (byApi.get(apiKey) ?? 0) + 1);
  capInnerMemoryCounts(byApi, apiKey);
  evictStaleMemoryCounts(now);
};

const memorySnapshot = (date: string): Map<string, number> => new Map(memoryCounts.get(date) ?? []);

/** Test helper — drop the in-process fallback counters. */
export const resetDingtalkApiCallStatsForTest = (): void => {
  memoryCounts.clear();
};

const parseCount = (value: string | number | null | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value !== 'string' || !value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const mergeByApi = (
  redis: Record<string, string> | null,
  memory: Map<string, number>,
): DingtalkApiCallStatsByApi[] => {
  const merged = new Map<string, number>();
  if (redis) {
    for (const [api, raw] of Object.entries(redis)) {
      const count = parseCount(raw);
      if (count > 0) merged.set(api, (merged.get(api) ?? 0) + count);
    }
  }
  for (const [api, count] of memory) {
    if (count > 0) merged.set(api, (merged.get(api) ?? 0) + count);
  }
  return [...merged.entries()]
    .map(([api, count]) => ({ api, count }))
    .sort((a, b) => b.count - a.count || a.api.localeCompare(b.api));
};

/**
 * Best-effort billed-call counter. Never throws. Redis hash
 * `dingtalk:api-calls:<YYYY-MM-DD Asia/Shanghai>` field = apiKey, 40-day TTL.
 * Falls back to an in-process counter when Redis is missing or errors.
 */
export const recordDingtalkApiCall = async (apiKey: string): Promise<void> => {
  const field = apiKey.trim();
  if (!field) return;
  const now = new Date();
  const date = formatDingtalkApiCallStatsDate(now);
  try {
    const redis = getAgentRuntimeRedisClient();
    if (!redis) {
      incrementMemory(date, field, now);
      return;
    }
    const key = dingtalkApiCallStatsRedisKey(date);
    await redis.hincrby(key, field, 1);
    await redis.expire(key, DINGTALK_API_CALL_STATS_TTL_SECONDS);
  } catch (error) {
    log('recordDingtalkApiCall redis failed: %O', error);
    incrementMemory(date, field, now);
  }
};

export const recordDingtalkHttpCall = (method: string, urlOrPath: string): void => {
  void recordDingtalkApiCall(toDingtalkApiCallKey(method, urlOrPath));
};

const hgetallDay = async (date: string): Promise<Record<string, string> | null> => {
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.hgetall(dingtalkApiCallStatsRedisKey(date));
    if (!raw || typeof raw !== 'object') return null;
    return raw as Record<string, string>;
  } catch (error) {
    log('getDingtalkApiCallStats hgetall failed: %O', error);
    return null;
  }
};

export const getDingtalkApiCallStats = async (input?: {
  days?: number;
  now?: Date;
}): Promise<DingtalkApiCallStats> => {
  const requested = input?.days ?? DINGTALK_API_CALL_STATS_DEFAULT_DAYS;
  const finite = Number.isFinite(requested) ? requested : DINGTALK_API_CALL_STATS_DEFAULT_DAYS;
  const days = Math.min(DINGTALK_API_CALL_STATS_MAX_DAYS, Math.max(1, Math.floor(finite)));
  const dates = lastNDaysOldestFirst(days, input?.now ?? new Date());
  const dayRows: DingtalkApiCallStatsDay[] = [];
  let total = 0;
  for (const date of dates) {
    const byApi = mergeByApi(await hgetallDay(date), memorySnapshot(date));
    const dayTotal = byApi.reduce((sum, row) => sum + row.count, 0);
    total += dayTotal;
    dayRows.push({ byApi, date, total: dayTotal });
  }
  return { days: dayRows, total };
};
