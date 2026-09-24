import dayjs from 'dayjs';

import { resolveActionHref } from '@/components/ActionLink/href';
import type { DingtalkPersonalFeature } from '@/services/dingtalkPersonal';

/**
 * The device-login link, only when it is DingTalk's own https page (`dingtalk.com` or a subdomain).
 * It becomes a QR code, a copy action and an 「打开授权页」 button, so anything else — another host,
 * `http:`, control characters — is refused rather than shown.
 */
export const resolveVerificationUrl = (value: unknown): string | undefined => {
  const target = resolveActionHref(value);
  if (!target?.external) return undefined;

  try {
    const host = new URL(target.href).hostname.toLowerCase();
    return host === 'dingtalk.com' || host.endsWith('.dingtalk.com') ? target.href : undefined;
  } catch {
    return undefined;
  }
};

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

/**
 * In the order they are listed on the card: the reads first (to-dos, group messages, reports, then
 * the documents and sheets of `lobe-dingtalk-docs`), the write permission last.
 */
export const DINGTALK_PERSONAL_FEATURES = [
  'todo',
  'chat',
  'report',
  'docs',
  'sheets',
  'write',
] as const satisfies readonly DingtalkPersonalFeature[];

export const listEnabledFeatures = (
  features: Partial<Record<DingtalkPersonalFeature, boolean>> | undefined,
): DingtalkPersonalFeature[] =>
  DINGTALK_PERSONAL_FEATURES.filter((feature) => features?.[feature] === true);
