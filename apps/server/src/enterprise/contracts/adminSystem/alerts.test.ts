import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STATUS_ALERT_SETTINGS,
  statusAlertRobotWebhookInputSchema,
} from '@/types/platform/statusAlerts';

import { adminSystemAlertsTestInputSchema, adminSystemAlertsUpdateInputSchema } from './alerts';

const webhook = 'https://oapi.dingtalk.com/robot/send?access_token=abc';

describe('admin system alert contracts', () => {
  it('requires a DingTalk robot webhook, at most 20 emails, and known roles', () => {
    expect(
      adminSystemAlertsUpdateInputSchema.safeParse({
        expectedRevision: 0,
        settings: DEFAULT_STATUS_ALERT_SETTINGS,
      }).success,
    ).toBe(true);

    const badWebhook = adminSystemAlertsUpdateInputSchema.safeParse({
      expectedRevision: 0,
      settings: {
        ...DEFAULT_STATUS_ALERT_SETTINGS,
        channels: {
          ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
          dingtalkRobot: { enabled: true, keyword: null, webhookUrl: 'https://evil.example/hook' },
        },
      },
    });
    expect(badWebhook.success).toBe(false);

    const tooManyEmails = adminSystemAlertsUpdateInputSchema.safeParse({
      expectedRevision: 1,
      settings: {
        ...DEFAULT_STATUS_ALERT_SETTINGS,
        channels: {
          ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
          email: {
            enabled: true,
            recipients: Array.from({ length: 21 }, (_, index) => `user${index}@example.com`),
          },
        },
      },
    });
    expect(tooManyEmails.success).toBe(false);

    const badRole = adminSystemAlertsUpdateInputSchema.safeParse({
      expectedRevision: 1,
      settings: {
        ...DEFAULT_STATUS_ALERT_SETTINGS,
        channels: {
          ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
          workNotice: {
            ...DEFAULT_STATUS_ALERT_SETTINGS.channels.workNotice,
            roles: ['platform_user'],
          },
        },
      },
    });
    expect(badRole.success).toBe(false);

    const enabledRobot = adminSystemAlertsUpdateInputSchema.parse({
      expectedRevision: 2,
      robotSecret: { action: 'replace', value: 'SEC' },
      settings: {
        ...DEFAULT_STATUS_ALERT_SETTINGS,
        channels: {
          ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
          dingtalkRobot: { enabled: true, keyword: '状态', webhookUrl: webhook },
        },
      },
    });
    expect(enabledRobot.robotSecret).toEqual({ action: 'replace', value: 'SEC' });
    expect(adminSystemAlertsTestInputSchema.safeParse({ channel: 'email' }).success).toBe(true);
    expect(adminSystemAlertsTestInputSchema.safeParse({ channel: 'sms' }).success).toBe(false);
    expect(
      adminSystemAlertsUpdateInputSchema.safeParse({
        expectedRevision: 0,
        settings: {
          ...DEFAULT_STATUS_ALERT_SETTINGS,
          channels: {
            ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
            dingtalkRobot: { enabled: true, keyword: null, webhookUrl: null },
          },
        },
      }).success,
    ).toBe(true);
    expect(
      statusAlertRobotWebhookInputSchema.safeParse({ action: 'replace', value: webhook }).success,
    ).toBe(true);
    expect(
      statusAlertRobotWebhookInputSchema.safeParse({
        action: 'replace',
        value: 'https://example.com/hook',
      }).success,
    ).toBe(false);
    expect(
      adminSystemAlertsUpdateInputSchema.safeParse({
        expectedRevision: 0,
        robotSecret: { action: 'replace', value: '' },
        settings: DEFAULT_STATUS_ALERT_SETTINGS,
      }).success,
    ).toBe(false);
  });
});
