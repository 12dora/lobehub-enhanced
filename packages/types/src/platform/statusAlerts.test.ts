import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STATUS_ALERT_SETTINGS,
  DINGTALK_ROBOT_WEBHOOK_PATTERN,
  dingtalkRobotWebhookHint,
  normalizeStatusAlertSettings,
  PLATFORM_ADMIN_ALERT_ROLE_KEYS,
  readStatusAlertWebhookUrl,
  statusAlertSettingsSchema,
} from './statusAlerts';

const webhook = 'https://oapi.dingtalk.com/robot/send?access_token=token123';

describe('normalizeStatusAlertSettings', () => {
  it('fills defaults for an empty document', () => {
    expect(normalizeStatusAlertSettings(undefined)).toEqual(DEFAULT_STATUS_ALERT_SETTINGS);
    expect(normalizeStatusAlertSettings({})).toEqual(DEFAULT_STATUS_ALERT_SETTINGS);
    expect(DEFAULT_STATUS_ALERT_SETTINGS.channels.workNotice.roles).toEqual([
      ...PLATFORM_ADMIN_ALERT_ROLE_KEYS,
    ]);
    expect(DEFAULT_STATUS_ALERT_SETTINGS.repeatIntervalHours).toBe(6);
    expect(DEFAULT_STATUS_ALERT_SETTINGS.dingtalkApiDailyThreshold).toBeNull();
  });

  it('keeps a valid partial and drops an invalid webhook', () => {
    const normalized = normalizeStatusAlertSettings({
      channels: {
        dingtalkRobot: { enabled: true, webhookUrl: 'https://example.com/hook' },
        email: { enabled: true, recipients: ['Ops@Example.com', 'ops@example.com'] },
      },
      repeatIntervalHours: 12,
    });
    expect(normalized.repeatIntervalHours).toBe(12);
    expect(normalized.enabled).toBe(true);
    expect(normalized.channels.email.recipients).toEqual(['ops@example.com']);
    expect(normalized.channels.dingtalkRobot).toEqual({
      enabled: true,
      keyword: null,
      webhookUrl: null,
    });
    expect(
      normalizeStatusAlertSettings({
        channels: { dingtalkRobot: { enabled: true, webhookUrl: webhook } },
      }).channels.dingtalkRobot,
    ).toEqual({ enabled: true, keyword: null, webhookUrl: null });
    expect(
      readStatusAlertWebhookUrl({ channels: { dingtalkRobot: { webhookUrl: webhook } } }),
    ).toBe(webhook);
    expect(dingtalkRobotWebhookHint(webhook)).toBe(
      'https://oapi.dingtalk.com/robot/send?access_token=…n123',
    );
    expect(normalized.rules.dependencies).toBe(true);
  });

  it('accepts a DingTalk robot webhook and rejects other URLs', () => {
    expect(DINGTALK_ROBOT_WEBHOOK_PATTERN.test(webhook)).toBe(true);
    expect(
      statusAlertSettingsSchema.safeParse({
        ...DEFAULT_STATUS_ALERT_SETTINGS,
        channels: {
          ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
          dingtalkRobot: { enabled: true, keyword: '告警', webhookUrl: webhook },
        },
      }).success,
    ).toBe(true);
    expect(
      statusAlertSettingsSchema.safeParse({
        ...DEFAULT_STATUS_ALERT_SETTINGS,
        channels: {
          ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
          dingtalkRobot: {
            enabled: true,
            keyword: null,
            webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=t&timestamp=1',
          },
        },
      }).success,
    ).toBe(false);
    expect(
      statusAlertSettingsSchema.safeParse({
        ...DEFAULT_STATUS_ALERT_SETTINGS,
        channels: {
          ...DEFAULT_STATUS_ALERT_SETTINGS.channels,
          email: { enabled: true, recipients: Array.from({ length: 21 }, (_, i) => `a${i}@e.com`) },
        },
      }).success,
    ).toBe(false);
  });
});
