import debug from 'debug';

import type { LobeChatDatabase, Transaction } from '@/database/type';

import type { ImConnectorStats } from '../../contracts/adminImConnectors';
import { countImConnectorLinkedUsers } from './bindings';

const log = debug('lobe-server:admin:imConnectors');

export const IM_CONNECTOR_STATS_TIMEZONE = 'Asia/Shanghai';
export const IM_CONNECTOR_STATS_WINDOW_DAYS = 7;

export const IM_CONNECTOR_MESSAGES_COUNTER_KEY = (platform: string, ymd: string): string =>
  `messenger:${platform}:counter:messages:${ymd}`;

export const IM_CONNECTOR_PUSHES_COUNTER_KEY = (platform: string, ymd: string): string =>
  `messenger:${platform}:counter:pushes:${ymd}`;

export interface ImConnectorRedisMget {
  mget: (...keys: string[]) => Promise<(string | null)[]>;
}

/** `YYYY-MM-DD` in `timeZone` for `date`. */
export const formatYmdInTimeZone = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).format(date);

/** Last `n` calendar days in `timeZone`, newest first (today … today-(n-1)). */
export const lastNDaysYmd = (n: number, timeZone: string, now = new Date()): string[] => {
  const today = formatYmdInTimeZone(now, timeZone);
  const [year, month, day] = today.split('-').map(Number);
  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  const days: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const cursor = new Date(utcNoon - i * 86_400_000);
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cursor.getUTCDate()).padStart(2, '0');
    days.push(`${y}-${m}-${d}`);
  }
  return days;
};

const parseCounter = (value: string | null | undefined): number => {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const sumCounters = async (redis: ImConnectorRedisMget | null, keys: string[]): Promise<number> => {
  if (!redis || keys.length === 0) return 0;
  try {
    const values = await redis.mget(...keys);
    return values.reduce((total, value) => total + parseCounter(value), 0);
  } catch (error) {
    log('Redis mget failed for IM connector stats, falling back to 0: %O', error);
    return 0;
  }
};

export const getImConnectorStats = async (params: {
  db: LobeChatDatabase | Transaction;
  now?: Date;
  platform: string;
  redis: ImConnectorRedisMget | null;
}): Promise<ImConnectorStats> => {
  const days = lastNDaysYmd(
    IM_CONNECTOR_STATS_WINDOW_DAYS,
    IM_CONNECTOR_STATS_TIMEZONE,
    params.now,
  );
  const [linkedUsers, messages7d, pushes7d] = await Promise.all([
    countImConnectorLinkedUsers(params.db, params.platform),
    sumCounters(
      params.redis,
      days.map((ymd) => IM_CONNECTOR_MESSAGES_COUNTER_KEY(params.platform, ymd)),
    ),
    sumCounters(
      params.redis,
      days.map((ymd) => IM_CONNECTOR_PUSHES_COUNTER_KEY(params.platform, ymd)),
    ),
  ]);

  return { linkedUsers, messages7d, pushes7d };
};
