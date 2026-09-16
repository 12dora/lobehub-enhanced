// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  adminImConnectorUpsertInputSchema,
  adminImConnectorViewSchema,
  dingTalkConnectorSettingsSchema,
} from './adminImConnectors';

const UPSERT_BASE = {
  aiCardTemplateId: null,
  chatEnabled: true,
  clientId: 'ding-app-key',
  clientSecret: { action: 'replace' as const, value: 'client-secret' },
  enabled: true,
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  platform: 'dingtalk' as const,
  pushEnabled: true,
  robotCode: 'ding-robot',
  selectCardTemplateId: null,
};

describe('dingTalkConnectorSettingsSchema', () => {
  it('defaults notify-app channel switches to true', () => {
    const settings = dingTalkConnectorSettingsSchema.parse({ robotCode: 'ding-robot' });
    expect(settings.notifyWorkNoticeEnabled).toBe(true);
    expect(settings.notifyRobotEnabled).toBe(true);
    expect(settings.pushEnabled).toBe(true);
  });

  it('persists explicit false on both notify-app channels', () => {
    const settings = dingTalkConnectorSettingsSchema.parse({
      notifyRobotEnabled: false,
      notifyWorkNoticeEnabled: false,
      robotCode: 'ding-robot',
    });
    expect(settings.notifyWorkNoticeEnabled).toBe(false);
    expect(settings.notifyRobotEnabled).toBe(false);
  });
});

describe('adminImConnectorUpsertInputSchema', () => {
  it('defaults omitted notify-app channel switches to true', () => {
    const input = adminImConnectorUpsertInputSchema.parse(UPSERT_BASE);
    expect(input.notifyWorkNoticeEnabled).toBe(true);
    expect(input.notifyRobotEnabled).toBe(true);
  });

  it('accepts false for both notify-app channel switches', () => {
    const input = adminImConnectorUpsertInputSchema.parse({
      ...UPSERT_BASE,
      notifyRobotEnabled: false,
      notifyWorkNoticeEnabled: false,
    });
    expect(input.notifyWorkNoticeEnabled).toBe(false);
    expect(input.notifyRobotEnabled).toBe(false);
  });
});

describe('adminImConnectorViewSchema', () => {
  it('requires the notify-app channel switches', () => {
    const parsed = adminImConnectorViewSchema.safeParse({
      aiCardTemplateId: null,
      chatEnabled: true,
      clientId: null,
      clientSecretFingerprint: null,
      configured: false,
      enabled: false,
      hasClientSecret: false,
      idleNewTopicEnabled: true,
      idleNewTopicHours: 24,
      notifyAgentId: null,
      notifyAppKey: null,
      notifyAppSecretSet: false,
      platform: 'dingtalk',
      pushEnabled: true,
      robotCode: null,
      selectCardTemplateId: null,
      stats: { linkedUsers: 0, messages7d: 0, pushes7d: 0 },
      status: {
        connectedAt: null,
        lastError: null,
        lastErrorAt: null,
        lastEventAt: null,
        state: 'unknown',
      },
      updatedAt: null,
    });
    expect(parsed.success).toBe(false);

    const withFlags = adminImConnectorViewSchema.parse({
      aiCardTemplateId: null,
      chatEnabled: true,
      clientId: null,
      clientSecretFingerprint: null,
      configured: false,
      enabled: false,
      hasClientSecret: false,
      idleNewTopicEnabled: true,
      idleNewTopicHours: 24,
      notifyAgentId: null,
      notifyAppKey: null,
      notifyAppSecretSet: false,
      notifyRobotEnabled: true,
      notifyWorkNoticeEnabled: true,
      platform: 'dingtalk',
      pushEnabled: true,
      robotCode: null,
      selectCardTemplateId: null,
      stats: { linkedUsers: 0, messages7d: 0, pushes7d: 0 },
      status: {
        connectedAt: null,
        lastError: null,
        lastErrorAt: null,
        lastEventAt: null,
        state: 'unknown',
      },
      updatedAt: null,
    });
    expect(withFlags.notifyWorkNoticeEnabled).toBe(true);
    expect(withFlags.notifyRobotEnabled).toBe(true);
  });
});
