import type { ImConnectorStatus, ImConnectorStreamState } from '../../contracts/adminImConnectors';
import { imConnectorStatusSchema } from '../../contracts/adminImConnectors';

export const IM_CONNECTOR_STREAM_STATUS_KEY = (platform: string): string =>
  `messenger:${platform}:stream-status`;

const UNKNOWN_STATUS: ImConnectorStatus = {
  connectedAt: null,
  lastError: null,
  lastErrorAt: null,
  lastEventAt: null,
  state: 'unknown',
};

export interface ImConnectorRedisGet {
  get: (key: string) => Promise<string | null>;
}

const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Live stream status. Missing Redis key → `unknown`. Disabled connector row
 * forces `state: 'disabled'` even if a stale heartbeat is still in Redis.
 */
export const readImConnectorStatus = async (params: {
  platform: string;
  redis: ImConnectorRedisGet | null;
  rowDisabled: boolean;
}): Promise<ImConnectorStatus> => {
  if (params.rowDisabled) {
    const live = params.redis
      ? await readLiveStatus(params.redis, params.platform)
      : UNKNOWN_STATUS;
    return { ...live, state: 'disabled' };
  }

  if (!params.redis) return UNKNOWN_STATUS;
  return readLiveStatus(params.redis, params.platform);
};

const readLiveStatus = async (
  redis: ImConnectorRedisGet,
  platform: string,
): Promise<ImConnectorStatus> => {
  let raw: string | null;
  try {
    raw = await redis.get(IM_CONNECTOR_STREAM_STATUS_KEY(platform));
  } catch {
    return UNKNOWN_STATUS;
  }
  if (!raw) return UNKNOWN_STATUS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return UNKNOWN_STATUS;
  }
  if (!parsed || typeof parsed !== 'object') return UNKNOWN_STATUS;

  const record = parsed as Record<string, unknown>;
  const state = record.state as ImConnectorStreamState | undefined;
  const candidate = imConnectorStatusSchema.safeParse({
    connectedAt: asNullableString(record.connectedAt),
    lastError: asNullableString(record.lastError),
    lastErrorAt: asNullableString(record.lastErrorAt),
    lastEventAt: asNullableString(record.lastEventAt),
    state,
  });
  return candidate.success ? candidate.data : UNKNOWN_STATUS;
};
