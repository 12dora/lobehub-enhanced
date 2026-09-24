// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  adminImConnectorApiCallStatsOutputSchema,
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

  it('defaults workspace switches off and automation tier to moderate', () => {
    const settings = dingTalkConnectorSettingsSchema.parse({ robotCode: 'ding-robot' });
    expect(settings.workspaceApprovalEnabled).toBe(false);
    expect(settings.workspaceTodoEnabled).toBe(false);
    expect(settings.workspaceCalendarEnabled).toBe(false);
    expect(settings.personalDataEnabled).toBe(false);
    expect(settings.personalDocsEnabled).toBe(false);
    expect(settings.personalTodoEnabled).toBe(false);
    expect(settings.personalChatEnabled).toBe(false);
    expect(settings.personalReportEnabled).toBe(false);
    expect(settings.personalSheetsEnabled).toBe(false);
    expect(settings.personalWriteEnabled).toBe(false);
    expect(settings.approvalAutomationTier).toBe('moderate');
    expect(settings.robotDisplayName).toBe('');
  });

  it('keeps an explicit personal-data switch', () => {
    const settings = dingTalkConnectorSettingsSchema.parse({
      personalDataEnabled: true,
      personalDocsEnabled: true,
      personalSheetsEnabled: false,
      personalTodoEnabled: true,
      personalWriteEnabled: false,
      robotCode: 'ding-robot',
    });
    expect(settings.personalDataEnabled).toBe(true);
    expect(settings.personalDocsEnabled).toBe(true);
    expect(settings.personalSheetsEnabled).toBe(false);
    expect(settings.personalTodoEnabled).toBe(true);
    expect(settings.personalChatEnabled).toBe(false);
    expect(settings.personalWriteEnabled).toBe(false);
  });

  it('trims robotDisplayName and rejects names longer than 32', () => {
    expect(
      dingTalkConnectorSettingsSchema.parse({
        robotCode: 'ding-robot',
        robotDisplayName: '  AI 助手  ',
      }).robotDisplayName,
    ).toBe('AI 助手');
    expect(
      dingTalkConnectorSettingsSchema.safeParse({
        robotCode: 'ding-robot',
        robotDisplayName: 'a'.repeat(33),
      }).success,
    ).toBe(false);
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

  it('accepts null robotDisplayName as an explicit clear', () => {
    const input = adminImConnectorUpsertInputSchema.parse({
      ...UPSERT_BASE,
      robotDisplayName: null,
    });
    expect(input.robotDisplayName).toBeNull();
  });

  it('defaults omitted personal-data switches to false', () => {
    const input = adminImConnectorUpsertInputSchema.parse(UPSERT_BASE);
    expect(input.personalDataEnabled).toBe(false);
    expect(input.personalDocsEnabled).toBe(false);
    expect(input.personalTodoEnabled).toBe(false);
    expect(input.personalChatEnabled).toBe(false);
    expect(input.personalReportEnabled).toBe(false);
    expect(input.personalSheetsEnabled).toBe(false);
    expect(input.personalWriteEnabled).toBe(false);
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

describe('adminImConnectorApiCallStatsOutputSchema', () => {
  it('accepts the billed-call counter shape', () => {
    expect(
      adminImConnectorApiCallStatsOutputSchema.parse({
        days: [
          {
            byApi: [{ api: 'POST /topapi/v2/department/listsub', count: 39 }],
            date: '2026-09-21',
            total: 39,
          },
        ],
        total: 39,
      }),
    ).toMatchObject({ total: 39 });
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
      approvalAutomationTier: 'moderate',
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
      personal: { authorizedCount: 2, brokerConfigured: true },
      personalChatEnabled: false,
      personalDataEnabled: true,
      personalDocsEnabled: false,
      personalReportEnabled: false,
      personalSheetsEnabled: false,
      personalTodoEnabled: true,
      personalWriteEnabled: false,
      workspaceApprovalEnabled: false,
      workspaceCalendarEnabled: false,
      workspaceTodoEnabled: false,
    });
    expect(withFlags.notifyWorkNoticeEnabled).toBe(true);
    expect(withFlags.notifyRobotEnabled).toBe(true);
    expect(withFlags.workspaceApprovalEnabled).toBe(false);
    expect(withFlags.approvalAutomationTier).toBe('moderate');
    expect(withFlags.personalDataEnabled).toBe(true);
    expect(withFlags.personal).toEqual({ authorizedCount: 2, brokerConfigured: true });
  });
});
