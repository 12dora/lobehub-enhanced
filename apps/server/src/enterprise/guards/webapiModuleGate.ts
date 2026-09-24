/**
 * Hot webapi / Hono gate: path prefix → platform module.
 *
 * Disabled modules answer 403 `{ error: 'PLATFORM_MODULE_DISABLED', moduleId }`
 * (never 404). Unmapped paths pass through — they are core.
 */
import type { MiddlewareHandler } from 'hono';

import { PLATFORM_ERROR_CODES } from '@/const/platform/errorCodes';
import type { PlatformModuleId } from '@/const/platform/modules';

import { isModuleEnabled } from '../services/moduleSettings';

export interface WebapiModulePrefix {
  moduleId: PlatformModuleId;
  prefix: string;
}

/**
 * Longest-prefix-first. Derived from the agent-hono handler list plus the
 * workflows-hono mounts that live under `/api/workflows`.
 */
export const WEBAPI_MODULE_PREFIXES: readonly WebapiModulePrefix[] = [
  { moduleId: 'bots', prefix: '/api/agent/gateway' },
  { moduleId: 'bots', prefix: '/api/agent/webhooks' },
  { moduleId: 'bots', prefix: '/api/agent/messenger' },
  { moduleId: 'agentSignal', prefix: '/api/workflows/agent-signal' },
  { moduleId: 'memory', prefix: '/api/workflows/memory-user-memory' },
  { moduleId: 'workflows', prefix: '/api/workflows' },
];

/** Queue-mode completion. Platform comes from the body, not the path. */
const BOT_CALLBACK_PATH = '/api/agent/webhooks/bot-callback';

/**
 * Pre-auth classification cap. Larger (or unknown and over this size) bodies
 * are not parsed; the request falls back to the `bots` gate.
 */
export const BOT_CALLBACK_BODY_LIMIT_BYTES = 1024 * 1024;

/** Not platform traffic. `bots` must not block these callbacks. */
const UNGATED_WEBHOOK_PATHS = new Set([
  '/api/agent/webhooks/subagent-callback',
  '/api/agent/webhooks/group-member-callback',
]);

const canonicalize = (path: string): string => {
  const withoutQuery = path.split('?')[0] ?? path;
  if (withoutQuery.startsWith('/api/')) return withoutQuery;
  // Hono `basePath` mounts sometimes report the suffix only.
  if (
    withoutQuery.startsWith('/agent-signal') ||
    withoutQuery.startsWith('/memory-user-memory') ||
    withoutQuery.startsWith('/task') ||
    withoutQuery.startsWith('/verify')
  ) {
    return `/api/workflows${withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`}`;
  }
  return `/api/agent${withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`}`;
};

/** Launcher polls this path; the handler must answer 200 `{ ok:false, disabled:true }`. */
const GATEWAY_START_PATH = '/api/agent/gateway/start';

export const resolveWebapiModuleId = (path: string): PlatformModuleId | undefined => {
  const canonical = canonicalize(path);
  if (canonical === GATEWAY_START_PATH) return undefined;
  if (UNGATED_WEBHOOK_PATHS.has(canonical) || canonical === BOT_CALLBACK_PATH) return undefined;
  for (const { prefix, moduleId } of WEBAPI_MODULE_PREFIXES) {
    if (canonical === prefix || canonical.startsWith(`${prefix}/`)) return moduleId;
  }
  return undefined;
};

const platformToken = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const token = value.split(':')[0]?.trim().toLowerCase();
  return token || undefined;
};

/**
 * DingTalk queue-mode callbacks use `dingtalk`. Every other platform, and a
 * body that does not name one, stays on `bots`.
 */
export const moduleIdForBotCallbackBody = (body: unknown): PlatformModuleId => {
  if (!body || typeof body !== 'object') return 'bots';
  const record = body as Record<string, unknown>;
  const platform =
    platformToken(record.platform) ??
    platformToken(record.platformThreadId) ??
    platformToken(record.messengerInstallationKey);
  return platform === 'dingtalk' ? 'dingtalk' : 'bots';
};

const declaredContentLength = (request: Request): number | undefined => {
  const raw = request.headers.get('content-length');
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
};

const decodeChunks = (chunks: Uint8Array[], total: number): string => {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
};

/** Read at most `limit` bytes from a clone. `undefined` when the body is larger. */
const readCappedCloneText = async (
  request: Request,
  limit: number,
): Promise<string | undefined> => {
  const cloned = request.clone();
  if (!cloned.body) {
    const text = await cloned.text();
    return new TextEncoder().encode(text).byteLength > limit ? undefined : text;
  }

  const reader = cloned.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch {
    return undefined;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // cancel() already released the lock
    }
  }
  return decodeChunks(chunks, total);
};

/**
 * Classify a bot-callback body without parsing an unbounded payload.
 * A declared Content-Length over the cap is not read. A missing length is
 * read only up to the cap; anything larger falls through as "no platform".
 */
const readJsonClone = async (request: Request): Promise<unknown> => {
  const declared = declaredContentLength(request);
  if (declared !== undefined && declared > BOT_CALLBACK_BODY_LIMIT_BYTES) return undefined;
  try {
    const text = await readCappedCloneText(request, BOT_CALLBACK_BODY_LIMIT_BYTES);
    if (text === undefined || text.length === 0) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export const resolveWebapiModuleForRequest = async (
  request: Request,
  path: string,
): Promise<PlatformModuleId | undefined> => {
  if (canonicalize(path) === BOT_CALLBACK_PATH) {
    return moduleIdForBotCallbackBody(await readJsonClone(request));
  }
  return resolveWebapiModuleId(path);
};

export const platformModuleDisabledBody = (moduleId: PlatformModuleId) =>
  ({ error: PLATFORM_ERROR_CODES.PLATFORM_MODULE_DISABLED, moduleId }) as const;

export const gateWebapiRequest = async (request: Request): Promise<Response | null> => {
  const moduleId = await resolveWebapiModuleForRequest(request, new URL(request.url).pathname);
  if (!moduleId) return null;
  if (await isModuleEnabled(moduleId)) return null;
  return Response.json(platformModuleDisabledBody(moduleId), { status: 403 });
};

export const webapiModuleGate: MiddlewareHandler = async (c, next) => {
  const moduleId = await resolveWebapiModuleForRequest(c.req.raw, c.req.path);
  if (!moduleId) return next();
  if (await isModuleEnabled(moduleId)) return next();
  return c.json(platformModuleDisabledBody(moduleId), 403);
};

type WorkflowsRouteHandler = (request: Request, context?: unknown) => Promise<Response> | Response;

/** One-line wrap for concrete /api/workflows/.../route.ts POST exports. */
export const withWorkflowsModule = (handler: WorkflowsRouteHandler): WorkflowsRouteHandler => {
  return async (request, context) => {
    const denied = await gateWebapiRequest(request);
    if (denied) return denied;
    return handler(request, context);
  };
};
