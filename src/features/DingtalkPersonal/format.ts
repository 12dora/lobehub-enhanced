import dayjs from 'dayjs';

import type { DingtalkPersonalFeature } from '@/services/dingtalkPersonal';

/** `mm:ss` for the code's remaining lifetime; never negative. */
export const formatCountdown = (remainingMs: number): string => {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

/** Local `YYYY-MM-DD HH:mm`, or `null` for a missing / unparsable timestamp. */
export const formatAuthorizationTime = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : null;
};

/** In the order they are listed on the card: the reads first, the write permission last. */
export const DINGTALK_PERSONAL_FEATURES = [
  'todo',
  'chat',
  'report',
  'write',
] as const satisfies readonly DingtalkPersonalFeature[];

export const listEnabledFeatures = (
  features: Partial<Record<DingtalkPersonalFeature, boolean>> | undefined,
): DingtalkPersonalFeature[] =>
  DINGTALK_PERSONAL_FEATURES.filter((feature) => features?.[feature] === true);
