import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

/**
 * Rolling runtime-error counters for the status page. Writes are fire-and-forget
 * and never throw. Redis disabled (or a store failure) is a no-op — the 30s poll
 * must not depend on this module succeeding.
 */
export const RUNTIME_SUBSYSTEMS = [
  'approval_worker',
  'dingtalk_api',
  'dingtalk_stream',
  'document_export',
  'document_render',
  'local_system',
  'market',
  'memory',
  'reminder_worker',
  'sandbox',
  'system_agent',
  'task_scheduler',
] as const;

export type RuntimeSubsystem = (typeof RUNTIME_SUBSYSTEMS)[number];

export const RUNTIME_ERROR_MESSAGE_MAX = 300;
export const RUNTIME_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RUNTIME_ERROR_SPIKE_WINDOW_MS = 10 * 60 * 1000;
export const RUNTIME_ERROR_SPIKE_COUNT = 3;
export const RUNTIME_ERROR_EVENT_LIMIT = 50;
export const RUNTIME_ERROR_EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const RUNTIME_ERROR_HASH_TTL_SECONDS = 25 * 60 * 60;
const SPIKE_STAMP_LIMIT = 30;
const HOUR_MS = 60 * 60 * 1000;

const INDEX_KEY = 'platform:runtime-error:index';
const EVENTS_KEY = 'platform:runtime-error:events';

const SUBSYSTEM_SET = new Set<string>(RUNTIME_SUBSYSTEMS);

const hashKey = (subsystem: string): string => `platform:runtime-error:${subsystem}`;

export interface RuntimeErrorStore {
  expire: (key: string, seconds: number) => Promise<unknown>;
  hdel: (key: string, ...fields: string[]) => Promise<unknown>;
  hgetall: (key: string) => Promise<Record<string, string> | null>;
  hincrby: (key: string, field: string, increment: number) => Promise<number>;
  hset: (key: string, field: string, value: string) => Promise<unknown>;
  lpush: (key: string, value: string) => Promise<unknown>;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
  ltrim: (key: string, start: number, stop: number) => Promise<unknown>;
  sadd: (key: string, member: string) => Promise<unknown>;
  smembers: (key: string) => Promise<string[]>;
}

export interface RuntimeErrorSummaryItem {
  count24h: number;
  errors10m: number;
  firstAt: number | null;
  lastAt: number | null;
  lastError: string;
  subsystem: RuntimeSubsystem;
}

export interface RuntimeEventItem {
  at: number;
  level: 'error' | 'info' | 'warning';
  message: string;
  subsystem: string;
}

/**
 * Optional labels stored with one failure. `at` is the event time only.
 * String labels are scrubbed with the message so a provider, model, or
 * DingTalk upstream code survives on the status tile.
 */
export interface RuntimeErrorContext {
  at?: number;
  missingScopes?: readonly string[];
  model?: string;
  operation?: string;
  provider?: string;
  upstreamCode?: string | null;
}

export interface RuntimeErrorSummary {
  events: RuntimeEventItem[];
  subsystems: RuntimeErrorSummaryItem[];
}

const EMPTY_SUMMARY: RuntimeErrorSummary = { events: [], subsystems: [] };

const AUTH_SCHEME = 'Bearer|Basic|Token|Digest|Negotiate';
/** Header names, quoted (`"Authorization":"Basic …"`) or bare (`Authorization: Basic …`). */
const SECRET_HEADER =
  'proxy-authorization|authorization|set-cookie|cookie|x-acs-dingtalk-access-token|x-api-key|api-key';
/** JSON field names. Longer names first so `clientSecret` is not clipped to `secret`. */
const SECRET_JSON_FIELD =
  'clientSecret|accessToken|refreshToken|access_token|refresh_token|id_token|apiKey|api_key|password|passwd|secret|token';
/** Bare `name=value` keys. `api[_-]?key` covers apiKey, api_key, and api-key. */
const SECRET_ASSIGNMENT_FIELD =
  'clientSecret|accessToken|refreshToken|access_token|refresh_token|id_token|api[_-]?key|authorization|password|passwd|secret|token';
const SECRET_QUERY = 'access_token|refresh_token|id_token|signature|token|sign|key';

const QUOTED_STRING = String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'`;
/** Stop at `&` so a query string cannot hide the next secret inside one value. */
const BARE_VALUE = String.raw`[^\s&]+`;

const redactQuotedNames = (text: string, names: string): string =>
  text.replaceAll(
    new RegExp(
      String.raw`(["'])(${names})\1\s*:\s*(?:${QUOTED_STRING}|(?:${AUTH_SCHEME})\s+${BARE_VALUE}|${BARE_VALUE})`,
      'gi',
    ),
    (_match, quote: string, name: string) => `${quote}${name}${quote}:[redacted]`,
  );

/**
 * Strip secrets, tokens, and URL query strings, then clip.
 * Quoted header and JSON forms are removed before the looser `key=value` pass
 * so `{"Authorization":"Basic …"}` cannot survive as a stored status string.
 */
export const scrubRuntimeErrorMessage = (
  value: string,
  max: number = RUNTIME_ERROR_MESSAGE_MAX,
): string => {
  let text = value.replaceAll(/\s+/g, ' ').trim();
  text = text.replaceAll(/\b(?:https?|redis|rediss):\/\/\S+/gi, (raw) => {
    try {
      const parsed = new URL(raw);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return '[url]';
    }
  });
  text = redactQuotedNames(text, SECRET_HEADER);
  text = redactQuotedNames(text, SECRET_JSON_FIELD);
  text = text.replaceAll(
    new RegExp(
      String.raw`\b(${SECRET_HEADER})\s*[:=]\s*(?:${QUOTED_STRING}|(?:${AUTH_SCHEME})\s+${BARE_VALUE}|${BARE_VALUE})`,
      'gi',
    ),
    '$1=[redacted]',
  );
  text = text.replaceAll(
    new RegExp(
      String.raw`\b(${SECRET_ASSIGNMENT_FIELD})\s*[:=]\s*(?:${QUOTED_STRING}|${BARE_VALUE})`,
      'gi',
    ),
    '$1=[redacted]',
  );
  text = text.replaceAll(
    new RegExp(String.raw`\b(${AUTH_SCHEME})\s+${BARE_VALUE}`, 'gi'),
    '$1 [redacted]',
  );
  text = text.replaceAll(
    new RegExp(String.raw`([?&])(${SECRET_QUERY})=([^&#\s]+)`, 'gi'),
    '$1$2=[redacted]',
  );
  text = text.replaceAll(/\bsk-[A-Za-z0-9]{8,}\b/g, 'sk-[redacted]');
  if (text.length > max) text = text.slice(0, max);
  return text;
};

const errorText = (error: unknown): string => {
  if (error instanceof Error) {
    const message = error.message?.trim() ? error.message : error.name;
    return `${error.name}: ${message}`;
  }
  if (typeof error === 'string') return error;
  return 'unknown error';
};

let storeOverride: RuntimeErrorStore | null | undefined;
let tail: Promise<void> = Promise.resolve();

/** `undefined` uses the process Redis client. `null` forces the disabled no-op. */
export const setRuntimeErrorStoreForTest = (store: RuntimeErrorStore | null | undefined): void => {
  storeOverride = store;
  tail = Promise.resolve();
};

export const resetRuntimeErrorsForTest = (): void => {
  storeOverride = undefined;
  tail = Promise.resolve();
};

const adaptRedis = (redis: {
  expire: RuntimeErrorStore['expire'];
  hdel: RuntimeErrorStore['hdel'];
  hgetall: RuntimeErrorStore['hgetall'];
  hincrby: RuntimeErrorStore['hincrby'];
  hset: RuntimeErrorStore['hset'];
  lpush: RuntimeErrorStore['lpush'];
  lrange: RuntimeErrorStore['lrange'];
  ltrim: RuntimeErrorStore['ltrim'];
  sadd: RuntimeErrorStore['sadd'];
  smembers: RuntimeErrorStore['smembers'];
}): RuntimeErrorStore => redis;

const resolveStore = (): RuntimeErrorStore | null => {
  if (storeOverride === null) return null;
  if (storeOverride) return storeOverride;
  try {
    const redis = getAgentRuntimeRedisClient();
    return redis ? adaptRedis(redis) : null;
  } catch {
    return null;
  }
};

const enqueue = (job: () => Promise<void>): Promise<void> => {
  const run = tail.then(job, job);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

const parseStamps = (raw: string | undefined, now: number): number[] => {
  if (!raw) return [];
  const cutoff = now - RUNTIME_ERROR_SPIKE_WINDOW_MS;
  const stamps: number[] = [];
  for (const part of raw.split(',')) {
    const value = Number(part);
    if (Number.isFinite(value) && value >= cutoff && value <= now + 1000) stamps.push(value);
  }
  return stamps.slice(-SPIKE_STAMP_LIMIT);
};

const writeSummary = async (
  store: RuntimeErrorStore,
  subsystem: RuntimeSubsystem,
  message: string,
  now: number,
): Promise<void> => {
  const key = hashKey(subsystem);
  const hour = Math.floor(now / HOUR_MS);
  const existing = (await store.hgetall(key)) ?? {};
  const firstAtRaw = Number(existing.firstAt);
  const firstAt =
    Number.isFinite(firstAtRaw) && now - firstAtRaw < RUNTIME_ERROR_WINDOW_MS
      ? String(Math.floor(firstAtRaw))
      : String(now);
  const stamps = parseStamps(existing.recent, now);
  stamps.push(now);
  const kept = stamps.slice(-SPIKE_STAMP_LIMIT);
  const stale = Object.keys(existing).filter((field) => {
    if (!field.startsWith('b:')) return false;
    const bucket = Number(field.slice(2));
    return Number.isFinite(bucket) && bucket < hour - 23;
  });

  await store.hincrby(key, `b:${hour}`, 1);
  await store.hset(key, 'lastError', message);
  await store.hset(key, 'lastAt', String(now));
  await store.hset(key, 'firstAt', firstAt);
  await store.hset(key, 'recent', kept.join(','));
  if (stale.length > 0) await store.hdel(key, ...stale);
  await store.expire(key, RUNTIME_ERROR_HASH_TTL_SECONDS);
  await store.sadd(INDEX_KEY, subsystem);
  await store.expire(INDEX_KEY, RUNTIME_ERROR_EVENT_TTL_SECONDS);
};

const writeEvent = async (
  store: RuntimeErrorStore,
  event: { at: number; level: RuntimeEventItem['level']; message: string; subsystem: string },
): Promise<void> => {
  const payload = JSON.stringify({
    at: new Date(event.at).toISOString(),
    level: event.level,
    message: event.message,
    subsystem: event.subsystem,
  });
  await store.lpush(EVENTS_KEY, payload);
  await store.ltrim(EVENTS_KEY, 0, RUNTIME_ERROR_EVENT_LIMIT - 1);
  await store.expire(EVENTS_KEY, RUNTIME_ERROR_EVENT_TTL_SECONDS);
};

const isSubsystem = (value: string): value is RuntimeSubsystem => SUBSYSTEM_SET.has(value);

const pushContextLabel = (parts: string[], label: string, value: unknown): void => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) parts.push(`${label}=${trimmed}`);
    return;
  }
  if (!Array.isArray(value)) return;
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length > 0) parts.push(`${label}=${items.join(',')}`);
};

/** Labels other than `at`, in a stable order, ready to scrub with the message. */
export const formatRuntimeErrorContext = (context?: RuntimeErrorContext): string => {
  if (!context) return '';
  const parts: string[] = [];
  pushContextLabel(parts, 'provider', context.provider);
  pushContextLabel(parts, 'model', context.model);
  pushContextLabel(parts, 'operation', context.operation);
  pushContextLabel(parts, 'upstreamCode', context.upstreamCode);
  pushContextLabel(parts, 'missingScopes', context.missingScopes);
  return parts.length > 0 ? `[${parts.join(' ')}]` : '';
};

/**
 * Count one failure. Returns a promise that never rejects so callers on hot
 * paths can ignore it (`void recordRuntimeError(...)`).
 */
export const recordRuntimeError = (
  subsystem: RuntimeSubsystem,
  error: unknown,
  context?: RuntimeErrorContext,
): Promise<void> => {
  if (!isSubsystem(subsystem)) return Promise.resolve();
  const now = context?.at ?? Date.now();
  const labels = formatRuntimeErrorContext(context);
  const message = scrubRuntimeErrorMessage(
    labels ? `${labels} ${errorText(error)}` : errorText(error),
  );
  if (!message) return Promise.resolve();
  return enqueue(async () => {
    const store = resolveStore();
    if (!store) return;
    await writeSummary(store, subsystem, message, now);
    await writeEvent(store, { at: now, level: 'error', message, subsystem });
  }).catch(() => undefined);
};

/** Optional success mark. Does not clear the 24h count. Never throws. */
export const recordRuntimeSuccess = (
  subsystem: RuntimeSubsystem,
  context?: { at?: number },
): Promise<void> => {
  if (!isSubsystem(subsystem)) return Promise.resolve();
  const now = context?.at ?? Date.now();
  return enqueue(async () => {
    const store = resolveStore();
    if (!store) return;
    const key = hashKey(subsystem);
    await store.hset(key, 'lastSuccessAt', String(now));
    await store.expire(key, RUNTIME_ERROR_HASH_TTL_SECONDS);
    await store.sadd(INDEX_KEY, subsystem);
  }).catch(() => undefined);
};

/** History row for alerts and the status page. Never throws. */
export const appendRuntimeEvent = (event: {
  at?: number;
  level: RuntimeEventItem['level'];
  message: string;
  subsystem: string;
}): Promise<void> => {
  const subsystem = event.subsystem.trim().slice(0, 64);
  const message = scrubRuntimeErrorMessage(event.message);
  if (!subsystem || !message) return Promise.resolve();
  const at = event.at ?? Date.now();
  return enqueue(async () => {
    const store = resolveStore();
    if (!store) return;
    await writeEvent(store, { at, level: event.level, message, subsystem });
  }).catch(() => undefined);
};

const countBuckets = (hash: Record<string, string>, now: number): number => {
  const hour = Math.floor(now / HOUR_MS);
  let total = 0;
  for (const [field, raw] of Object.entries(hash)) {
    if (!field.startsWith('b:')) continue;
    const bucket = Number(field.slice(2));
    if (!Number.isFinite(bucket) || bucket < hour - 23) continue;
    const count = Number(raw);
    if (Number.isFinite(count) && count > 0) total += Math.floor(count);
  }
  return total;
};

const parseEvent = (raw: string): RuntimeEventItem | null => {
  try {
    const parsed = JSON.parse(raw) as {
      at?: string;
      level?: string;
      message?: string;
      subsystem?: string;
    };
    const at = parsed.at ? Date.parse(parsed.at) : Number.NaN;
    if (!Number.isFinite(at)) return null;
    if (parsed.level !== 'error' && parsed.level !== 'warning' && parsed.level !== 'info') {
      return null;
    }
    const subsystem = typeof parsed.subsystem === 'string' ? parsed.subsystem.trim() : '';
    const message = typeof parsed.message === 'string' ? parsed.message : '';
    if (!subsystem || !message) return null;
    return {
      at,
      level: parsed.level,
      message: message.slice(0, RUNTIME_ERROR_MESSAGE_MAX),
      subsystem,
    };
  } catch {
    return null;
  }
};

export const readRuntimeErrorSummary = async (
  now: number = Date.now(),
): Promise<RuntimeErrorSummary> => {
  try {
    const store = resolveStore();
    if (!store) return EMPTY_SUMMARY;
    const names = await store.smembers(INDEX_KEY);
    const subsystems: RuntimeErrorSummaryItem[] = [];
    for (const name of names) {
      if (!isSubsystem(name)) continue;
      const hash = (await store.hgetall(hashKey(name))) ?? {};
      const count24h = countBuckets(hash, now);
      const lastAt = Number(hash.lastAt);
      const firstAt = Number(hash.firstAt);
      const lastError = typeof hash.lastError === 'string' ? hash.lastError : '';
      if (count24h <= 0 && !lastError) continue;
      const errors10m = parseStamps(hash.recent, now).length;
      subsystems.push({
        count24h,
        errors10m,
        firstAt: Number.isFinite(firstAt) ? firstAt : null,
        lastAt: Number.isFinite(lastAt) ? lastAt : null,
        lastError,
        subsystem: name,
      });
    }
    subsystems.sort(
      (a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.subsystem.localeCompare(b.subsystem),
    );
    const rawEvents = await store.lrange(EVENTS_KEY, 0, RUNTIME_ERROR_EVENT_LIMIT - 1);
    const events: RuntimeEventItem[] = [];
    for (const raw of rawEvents) {
      const event = parseEvent(raw);
      if (event) events.push(event);
    }
    return { events, subsystems };
  } catch {
    return EMPTY_SUMMARY;
  }
};
