import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
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
