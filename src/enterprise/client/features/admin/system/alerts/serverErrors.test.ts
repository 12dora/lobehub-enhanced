import { describe, expect, it } from 'vitest';

import { normalizeAlertFieldPath, resolveAlertSaveError } from './serverErrors';

const rejection = (errorData: Record<string, unknown>) => ({ data: { errorData } });

describe('resolveAlertSaveError', () => {
  it("returns the server's message and the form field it names", () => {
    expect(
      resolveAlertSaveError(
        rejection({
          code: 'PLATFORM_INVALID_INPUT',
          details: { field: 'channels.workNotice.userIds' },
          message: '工作通知已启用，请至少选择一位接收人',
        }),
      ),
    ).toEqual({ field: 'recipients', message: '工作通知已启用，请至少选择一位接收人' });

    expect(
      resolveAlertSaveError(
        rejection({
          code: 'PLATFORM_INVALID_INPUT',
          details: { field: 'channels.dingtalkRobot.webhookUrl' },
          message: '群机器人已启用，请填写 Webhook',
        }),
      ),
    ).toEqual({ field: 'webhook', message: '群机器人已启用，请填写 Webhook' });
  });

  it('keeps a message without a field, and drops a bare error code', () => {
    expect(
      resolveAlertSaveError(
        rejection({ code: 'PLATFORM_INVALID_INPUT', message: '无法保存群机器人密钥' }),
      ),
    ).toEqual({ message: '无法保存群机器人密钥' });
    expect(
      resolveAlertSaveError(
        rejection({ code: 'PLATFORM_INVALID_INPUT', message: 'PLATFORM_INVALID_INPUT' }),
      ),
    ).toEqual({});
    expect(resolveAlertSaveError(new Error('network down'))).toEqual({});
  });

  it('maps contract paths onto the form fields that own them', () => {
    expect(normalizeAlertFieldPath('channels.workNotice.roles')).toBe('recipients');
    expect(normalizeAlertFieldPath('settings.channels.email.recipients.3')).toBe('emailRecipients');
    expect(normalizeAlertFieldPath('robotWebhook.value')).toBe('webhook');
    expect(normalizeAlertFieldPath('robotSecret')).toBe('robotSecret');
    expect(normalizeAlertFieldPath('repeatIntervalHours')).toBe('repeatIntervalHours');
    expect(normalizeAlertFieldPath('rules.workers')).toBeUndefined();
  });
});
