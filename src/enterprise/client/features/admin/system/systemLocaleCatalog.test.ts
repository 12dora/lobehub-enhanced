import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLATFORM_ADMIN_ALERT_ROLE_KEYS } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  adminStatusAlertChannelSchema,
  adminSystemCapabilityKeySchema,
  adminSystemInstanceRevisionSchema,
  adminSystemJobKindSchema,
  adminSystemRecentEventSchema,
} from '../../../../../../apps/server/src/enterprise/contracts/adminSystem';

const loadAdminLocale = (locale: 'en-US' | 'zh-CN'): Record<string, string> => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.join(here, '../../../../../../locales', locale, 'admin.json');
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>;
};

const instanceKinds = adminSystemInstanceRevisionSchema.shape.instanceKind.options;

describe('admin system value locale catalog (server-emitted)', () => {
  it('uses the server contracts as the sole coverage source (finite, non-empty)', () => {
    expect(adminSystemJobKindSchema.options.length).toBeGreaterThan(1);
    expect(instanceKinds.length).toBeGreaterThan(1);
  });

  it('has en-US and zh-CN labels for every job kind and instance kind', () => {
    const en = loadAdminLocale('en-US');
    const zh = loadAdminLocale('zh-CN');

    const missing: string[] = [];
    for (const kind of adminSystemJobKindSchema.options) {
      const key = `system.values.jobKind.${kind}`;
      if (!en[key]?.trim()) missing.push(`en:${key}`);
      if (!zh[key]?.trim()) missing.push(`zh:${key}`);
    }
    for (const kind of instanceKinds) {
      const key = `system.values.instanceKind.${kind}`;
      if (!en[key]?.trim()) missing.push(`en:${key}`);
      if (!zh[key]?.trim()) missing.push(`zh:${key}`);
    }

    expect(missing, `missing system value labels:\n${missing.join('\n')}`).toEqual([]);
  });

  it('keeps the instance section copy in sync across both shipped locales', () => {
    const en = loadAdminLocale('en-US');
    const zh = loadAdminLocale('zh-CN');
    const keys = [
      'system.instances.columns.startedAt',
      'system.instances.counts',
      'system.instances.empty',
      'system.instances.emptyAll',
      'system.instances.filter.showOffline',
      'system.instances.fresh',
      'system.instances.stale',
      'system.instances.title',
    ];

    for (const key of keys) {
      expect(en[key]?.trim(), `missing en:${key}`).toBeTruthy();
      expect(zh[key]?.trim(), `missing zh:${key}`).toBeTruthy();
    }
    for (const locale of [en, zh]) {
      expect(locale['system.instances.counts']).toContain('{{live}}');
      expect(locale['system.instances.counts']).toContain('{{offline}}');
    }
    // Dead keys removed with the ledger rename — they must not come back.
    for (const locale of [en, zh]) {
      expect(locale['system.instances.columns.domains']).toBeUndefined();
      expect(locale['system.instances.lagging']).toBeUndefined();
    }
  });

  it('keeps the SSO summary copy in sync across both shipped locales', () => {
    const en = loadAdminLocale('en-US');
    const zh = loadAdminLocale('zh-CN');
    const keys = [
      'system.oidc.attention',
      'system.oidc.attentionHint',
      'system.oidc.enabled',
      'system.oidc.enabledHint',
      'system.oidc.notConfigured',
      'system.oidc.notConfiguredHint',
      'system.oidc.pendingRestart',
      'system.oidc.pendingRestartHint',
      'system.oidc.source',
      'system.oidc.title',
      'system.values.oidcSource.break_glass',
      'system.values.oidcSource.database',
      'system.values.oidcSource.disabled',
      'system.values.oidcSource.environment',
      'system.values.oidcSource.lkg',
      'system.values.oidcSource.unknown',
    ];

    for (const key of keys) {
      expect(en[key]?.trim(), `missing en:${key}`).toBeTruthy();
      expect(zh[key]?.trim(), `missing zh:${key}`).toBeTruthy();
    }
    expect(en['system.oidc.source']).toContain('{{source}}');
    expect(zh['system.oidc.source']).toContain('{{source}}');
    // Replaced "Active at startup" / 「启动时已激活」 — do not bring it back.
    for (const locale of [en, zh]) {
      expect(locale['system.oidc.active']).toBeUndefined();
    }
  });
});

describe('admin system monitoring sections locale catalog', () => {
  it('labels every capability, its fix-it hint, and every event level in both locales', () => {
    const en = loadAdminLocale('en-US');
    const zh = loadAdminLocale('zh-CN');
    const keys = [
      ...adminSystemCapabilityKeySchema.options.flatMap((key) => [
        `system.capabilities.${key}`,
        `system.capabilities.hint.${key}`,
      ]),
      ...adminSystemRecentEventSchema.shape.level.options.map(
        (level) => `system.recentEvents.level.${level}`,
      ),
    ];

    const missing = keys.flatMap((key) => [
      ...(en[key]?.trim() ? [] : [`en:${key}`]),
      ...(zh[key]?.trim() ? [] : [`zh:${key}`]),
    ]);
    expect(missing, `missing monitoring labels:\n${missing.join('\n')}`).toEqual([]);
  });

  it('keeps interpolation placeholders in both locales', () => {
    const en = loadAdminLocale('en-US');
    const zh = loadAdminLocale('zh-CN');
    const placeholders: Record<string, string> = {
      'system.dependencies.checkedAt': '{{time}}',
      'system.interval.hours': '{{count}}',
      'system.interval.minutes': '{{count}}',
      'system.interval.seconds': '{{count}}',
      'system.recentEvents.showAll': '{{count}}',
      'system.relative.days': '{{count}}',
      'system.relative.hours': '{{count}}',
      'system.relative.minutes': '{{count}}',
      'system.relative.seconds': '{{count}}',
      'system.runtimeErrors.count': '{{count}}',
      'system.runtimeErrors.lastAt': '{{time}}',
      'system.sandbox.imageNamedMissing': '{{image}}',
      'system.sandbox.imageNamedReady': '{{image}}',
      'system.sandbox.pullPolicy': '{{policy}}',
      'system.summary.more': '{{count}}',
      'system.summary.problems': '{{count}}',
      'system.summary.runtimeLabel': '{{name}}',
      'system.workers.lastTick': '{{time}}',
    };

    for (const [key, placeholder] of Object.entries(placeholders)) {
      expect(en[key], `en:${key}`).toContain(placeholder);
      expect(zh[key], `zh:${key}`).toContain(placeholder);
    }
    expect(zh['system.summary.allHealthy']).toBe('全部正常');
  });
});

describe('status monitoring v1.12 copy (告警设置 / 状态 API / 近期任务)', () => {
  const RULE_KEYS = [
    'capabilities',
    'dependencies',
    'dingtalkApiBudget',
    'runtimeErrors',
    'workers',
  ];
  const ALERT_ERROR_KEYS = [
    'emailInvalid',
    'emailRequired',
    'emailTooMany',
    'invalid',
    'repeatInterval',
    'rolesRequired',
    'secretInvalid',
    'threshold',
    'usersRequired',
    'webhookRequired',
    'webhookUrl',
  ];
  const KEYS = [
    'system.actions.alertSettings',
    'system.actions.reauthCancelled',
    'system.alerts.close',
    'system.alerts.credential.stored',
    'system.alerts.channels.notifyModuleOff',
    'system.alerts.recipients.banned',
    'system.alerts.recipients.bannedHelp',
    'system.alerts.recipients.deleted',
    'system.alerts.test.unsaved',
    'system.capabilities.help',
    'system.instances.help',
    'system.workers.help',
    'system.jobs.actions.clear',
    'system.jobs.modal.clear.description',
    'system.jobs.modal.clear.title',
    'system.jobs.toast.clearFailed',
    'system.jobs.toast.cleared',
    'system.alerts.cancel',
    'system.alerts.channels.configure',
    'system.alerts.channels.mailMissing',
    'system.alerts.channels.notifyAppMissing',
    'system.alerts.channels.title',
    'system.alerts.channels.workNoticeHelp',
    'system.alerts.email.placeholder',
    'system.alerts.email.recipients',
    'system.alerts.enabled',
    'system.alerts.envDisabled',
    'system.alerts.envDisabledHelp',
    'system.alerts.loadFailed',
    'system.alerts.readOnly',
    'system.alerts.recipients.addUser',
    'system.alerts.recipients.label',
    'system.alerts.recipients.roles',
    'system.alerts.recipients.unbound',
    'system.alerts.recipients.users',
    'system.alerts.robot.keyword',
    'system.alerts.robot.keywordHelp',
    'system.alerts.robot.optional',
    'system.alerts.robot.secret',
    'system.alerts.robot.secretHelp',
    'system.alerts.robot.webhookUrl',
    'system.alerts.rules.notifyOnRecovery',
    'system.alerts.rules.repeatInterval',
    'system.alerts.rules.repeatIntervalHelp',
    'system.alerts.rules.threshold',
    'system.alerts.rules.thresholdDefault',
    'system.alerts.rules.thresholdHelp',
    'system.alerts.rules.thresholdPlaceholder',
    'system.alerts.rules.title',
    'system.alerts.save',
    'system.alerts.tabs.alerts',
    'system.alerts.tabs.statusApi',
    'system.alerts.test.action',
    'system.alerts.test.failed',
    'system.alerts.test.failedUnknown',
    'system.alerts.test.saveFirst',
    'system.alerts.test.success',
    'system.alerts.toast.conflict',
    'system.alerts.toast.saveFailed',
    'system.alerts.toast.saved',
    'system.statusApi.endpoint.events',
    'system.statusApi.endpoint.health',
    'system.statusApi.endpoint.summary',
    'system.statusApi.endpoints',
    'system.statusApi.healthNoAuth',
    'system.statusApi.help',
    'system.statusApi.loadFailed',
    'system.statusApi.modal.revoke.description',
    'system.statusApi.modal.revoke.title',
    'system.statusApi.modal.rotate.description',
    'system.statusApi.modal.rotate.title',
    'system.statusApi.toast.failed',
    'system.statusApi.toast.revoked',
    'system.statusApi.toast.rotated',
    'system.statusApi.token.copy',
    'system.statusApi.token.envConfigured',
    'system.statusApi.token.generate',
    'system.statusApi.token.notSet',
    'system.statusApi.token.once',
    'system.statusApi.token.revoke',
    'system.statusApi.token.rotate',
    'system.statusApi.token.set',
    'system.statusApi.token.title',
    ...adminStatusAlertChannelSchema.options.map(
      (channel) => `system.alerts.channels.${channel === 'dingtalkRobot' ? 'robot' : channel}`,
    ),
    ...RULE_KEYS.map((key) => `system.alerts.rules.${key}`),
    ...ALERT_ERROR_KEYS.map((key) => `system.alerts.errors.${key}`),
    // Recipient roles reuse the existing role names.
    ...PLATFORM_ADMIN_ALERT_ROLE_KEYS.map((role) => `users.roles.${role}`),
  ];

  it('has every new label in both shipped locales', () => {
    const en = loadAdminLocale('en-US');
    const zh = loadAdminLocale('zh-CN');
    const missing = KEYS.flatMap((key) => [
      ...(en[key]?.trim() ? [] : [`en:${key}`]),
      ...(zh[key]?.trim() ? [] : [`zh:${key}`]),
    ]);
    expect(missing, `missing labels:\n${missing.join('\n')}`).toEqual([]);
  });

  it('keeps interpolation placeholders in both locales', () => {
    const en = loadAdminLocale('en-US');
    const zh = loadAdminLocale('zh-CN');
    const placeholders: Record<string, string[]> = {
      'system.alerts.credential.stored': ['{{hint}}'],
      'system.alerts.errors.emailInvalid': ['{{value}}'],
      'system.alerts.errors.emailTooMany': ['{{max}}'],
      'system.alerts.errors.secretInvalid': ['{{max}}'],
      'system.alerts.rules.thresholdPlaceholder': ['{{value}}'],
      'system.alerts.test.failed': ['{{error}}'],
      'system.alerts.test.success': ['{{count}}'],
      'system.jobs.toast.cleared': ['{{count}}'],
      'system.statusApi.token.set': ['{{hint}}', '{{time}}'],
    };
    for (const [key, values] of Object.entries(placeholders)) {
      for (const placeholder of values) {
        expect(en[key], `en:${key}`).toContain(placeholder);
        expect(zh[key], `zh:${key}`).toContain(placeholder);
      }
    }
  });

  it('uses the agreed short copy for 清除 and the section tips', () => {
    const zh = loadAdminLocale('zh-CN');
    expect(zh['system.jobs.modal.clear.title']).toBe('清除已结束的任务？');
    expect(zh['system.jobs.modal.clear.description']).toBe(
      '进行中的任务不受影响，记录不会被删除。',
    );
    expect(zh['system.capabilities.help']).toBe('只检查配置，不调用模型或钉钉接口。');
    expect(zh['system.workers.help']).toBe('仅显示处理本次请求的实例。');
    expect(zh['system.instances.help']).toBe('超过 90 秒无心跳视为下线。');
    // A conflict keeps the operator's edits, so the copy asks for a review, not a reload.
    expect(zh['system.alerts.toast.conflict']).toBe('设置已被他人修改，请确认后再保存。');
  });

  it('does not promise that a token change takes effect instantly on every instance', () => {
    // Each instance re-reads the token within a minute; the copy says so instead of 「立即」.
    const zh = loadAdminLocale('zh-CN');
    const en = loadAdminLocale('en-US');
    for (const key of [
      'system.statusApi.modal.revoke.description',
      'system.statusApi.modal.rotate.description',
      'system.statusApi.token.once',
    ]) {
      expect(zh[key], key).toContain('1 分钟');
      expect(zh[key], key).not.toContain('立即失效');
      expect(en[key], key).toMatch(/within a minute/);
      expect(en[key], key).not.toMatch(/immediately/i);
    }
  });

  it('keeps tenant, product and sidecar names out of the 状态监控 copy', () => {
    // Environment variable names are identifiers an operator has to type, not branding.
    const ENV_VARS = /AIHUB_STATUS_ALERTS/g;
    for (const locale of [loadAdminLocale('zh-CN'), loadAdminLocale('en-US')]) {
      const offending = Object.entries(locale).filter(
        ([key, value]) =>
          key.startsWith('system.') && /aihub|服务号/i.test(value.replaceAll(ENV_VARS, '')),
      );
      expect(offending).toEqual([]);
    }
  });

  it('drops the section descriptions and the staged-update / load-more copy', () => {
    const removed = [
      'system.capabilities.description',
      'system.description',
      'system.instances.description',
      'system.jobs.actions.applyUpdates',
      'system.jobs.actions.loadMore',
      'system.jobs.description',
      'system.jobs.end',
      'system.jobs.loadMoreFailed',
      'system.jobs.pollFailed',
      'system.jobs.summaryTitle',
      'system.jobs.updatesAvailable',
      'system.jobs.updatesAvailableDescription',
      'system.recentEvents.description',
      'system.runtimeErrors.description',
      'system.workers.description',
    ];
    for (const locale of [loadAdminLocale('en-US'), loadAdminLocale('zh-CN')]) {
      for (const key of removed) expect(locale[key], key).toBeUndefined();
    }
  });
});
