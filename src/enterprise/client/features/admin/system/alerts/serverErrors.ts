import { readEnterpriseErrorBody } from '@/utils/enterpriseErrorBody';

import type { AlertDraftField } from './draft';

export interface AlertSaveError {
  /** Form field the server named in `details.field`, when the form has one for it. */
  field?: AlertDraftField;
  /** The server's own explanation (already user-facing, e.g. 「工作通知已启用，请至少选择一位接收人」). */
  message?: string;
}

/** Contract path (`details.field`) → the form field that owns it, longest prefix first. */
const FIELD_PREFIXES: ReadonlyArray<readonly [string, AlertDraftField]> = [
  ['channels.workNotice.roles', 'recipients'],
  ['channels.workNotice.userIds', 'recipients'],
  ['channels.workNotice', 'recipients'],
  ['channels.dingtalkRobot.webhookUrl', 'webhook'],
  ['robotWebhook', 'webhook'],
  ['robotSecret', 'robotSecret'],
  ['channels.email.recipients', 'emailRecipients'],
  ['channels.email', 'emailRecipients'],
  ['dingtalkApiDailyThreshold', 'threshold'],
  ['repeatIntervalHours', 'repeatIntervalHours'],
];

export const normalizeAlertFieldPath = (path: string): AlertDraftField | undefined => {
  const normalized = path.replace(/^settings\./, '');
  return FIELD_PREFIXES.find(
    ([prefix]) => normalized === prefix || normalized.startsWith(`${prefix}.`),
  )?.[1];
};

/** A bare error code (the default when the server passes no message) is not worth showing. */
const isReadableMessage = (message: string | undefined): message is string =>
  message !== undefined && message.trim().length > 0 && !/^[\w.]+$/.test(message.trim());

/**
 * Turn a rejected `alerts.update` into something the form can show: the server's message (it
 * names the actual rule that failed) and, when it points at one, the field to mark.
 */
export const resolveAlertSaveError = (error: unknown): AlertSaveError => {
  const body = readEnterpriseErrorBody(error);
  const rawField = body?.details?.field;
  const field = typeof rawField === 'string' ? normalizeAlertFieldPath(rawField) : undefined;
  const rawMessage = body?.message;
  const message = isReadableMessage(rawMessage) ? rawMessage.trim() : undefined;
  return { ...(field ? { field } : {}), ...(message ? { message } : {}) };
};
