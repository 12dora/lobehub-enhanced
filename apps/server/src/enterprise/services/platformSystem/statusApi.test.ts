import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import {
  authorizeStatusApiBearer,
  buildStatusApiEvents,
  buildStatusApiHealth,
  buildStatusApiSummary,
  buildUnknownStatusApiSummary,
  createStatusApiToken,
  hashStatusApiToken,
  loadStatusApiSummary,
  parseStatusEventsQuery,
  resetStatusApiSummaryCacheForTest,
  resolveCachedTokenHash,
  STATUS_API_SUMMARY_CACHE_MS,
  STATUS_API_TOKEN_CACHE_MS,
  statusEventComponentId,
} from './statusApi';

const { getStatus } = vi.hoisted(() => ({ getStatus: vi.fn() }));

vi.mock('./adminService', () => ({
  PlatformSystemAdminService: class {
    getStatus = getStatus;
  },
}));

const checkedAt = new Date('2026-09-25T00:00:00.000Z');

const dependency = (status: string, extra: Record<string, unknown> = {}) => ({
  errorCategory: status === 'healthy' || status === 'disabled' ? null : 'operation_unavailable',
  lastCheckedAt: checkedAt,
  status,
  ...extra,
});

const snapshot = (overrides: Record<string, unknown> = {}) =>
  ({
    build: { gitSha: 'abc1234', version: '1.12.0' },
    capabilities: [],
    dependencies: {
      database: dependency('healthy', { latencyMs: 4 }),
      keyManagement: dependency('healthy'),
      mail: dependency('disabled'),
      objectStorage: dependency('healthy'),
      redis: dependency('healthy', { latencyMs: 1 }),
    },
    jobs: { active: 2, failed: 1 },
    runtimeErrors: [],
    snapshotAt: checkedAt,
    workers: [],
    ...overrides,
  }) as never;

const extras = {
  callsToday: 3,
  instanceId: 'pinst_test',
  instances: { live: 2, offline: 1 },
  siteName: '示例平台',
  threshold: 5000,
  url: 'https://example.com',
};

describe('status API auth', () => {
  const token = createStatusApiToken();

  it('issues an sk-status token and stores only its sha256 hint', () => {
    expect(token.token).toMatch(/^sk-status-[0-9A-Za-z]{32}$/);
    expect(token.hash).toBe(hashStatusApiToken(token.token));
    expect(token.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.hint).toBe(`sk-status-…${token.token.slice(-4)}`);
    expect(token.hint).not.toContain(token.token.slice(10, -4));
  });

  it('returns 503 when no token is configured, even if a bearer is sent', () => {
    expect(
      authorizeStatusApiBearer({
        authorization: `Bearer ${token.token}`,
        dbTokenHash: null,
        envToken: null,
      }),
    ).toEqual({ error: 'not_configured', ok: false, status: 503 });
    expect(
      authorizeStatusApiBearer({ authorization: null, dbTokenHash: '  ', envToken: '' }),
    ).toEqual({ error: 'not_configured', ok: false, status: 503 });
  });

  it('returns 401 for a missing or wrong bearer when a token is configured', () => {
    const params = { dbTokenHash: token.hash, envToken: null };
    expect(authorizeStatusApiBearer({ ...params, authorization: null })).toEqual({
      error: 'unauthorized',
      ok: false,
      status: 401,
    });
    expect(
      authorizeStatusApiBearer({ ...params, authorization: 'Bearer sk-status-wrong' }),
    ).toEqual({ error: 'unauthorized', ok: false, status: 401 });
    expect(
      authorizeStatusApiBearer({
        authorization: `Bearer ${token.token}`,
        dbTokenHash: hashStatusApiToken('sk-status-other'),
        envToken: 'not-the-token',
      }),
    ).toEqual({ error: 'unauthorized', ok: false, status: 401 });
  });

  it('accepts the database token or the env token', () => {
    expect(
      authorizeStatusApiBearer({
        authorization: `Bearer ${token.token}`,
        dbTokenHash: token.hash,
        envToken: null,
      }),
    ).toEqual({ ok: true });
    expect(
      authorizeStatusApiBearer({
        authorization: 'Bearer env-token',
        dbTokenHash: null,
        envToken: 'env-token',
      }),
    ).toEqual({ ok: true });
    expect(
      authorizeStatusApiBearer({
        authorization: `Bearer ${token.token}`,
        dbTokenHash: null,
        envToken: 'env-token',
      }),
    ).toEqual({ error: 'unauthorized', ok: false, status: 401 });
  });

  it('fails closed when the stored hash cannot be read and no env token is set', () => {
    expect(
      authorizeStatusApiBearer({
        authorization: `Bearer ${token.token}`,
        dbTokenHash: null,
        envToken: null,
        settingsUnreadable: true,
      }),
    ).toEqual({ error: 'unavailable', ok: false, status: 503 });
    expect(
      authorizeStatusApiBearer({
        authorization: `Bearer ${token.token}`,
        dbTokenHash: token.hash,
        envToken: null,
        settingsUnreadable: true,
      }),
    ).toEqual({ ok: true });
    const fresh = resolveCachedTokenHash(undefined, 1_000, { hash: token.hash, ok: true });
    expect(fresh).toMatchObject({ hash: token.hash, settingsUnreadable: false });
    const reused = resolveCachedTokenHash(fresh.cache, 1_000 + STATUS_API_TOKEN_CACHE_MS - 1, {
      ok: false,
    });
    expect(reused.hash).toBe(token.hash);
    const stale = resolveCachedTokenHash(fresh.cache, 1_000 + STATUS_API_TOKEN_CACHE_MS, {
      ok: false,
    });
    expect(stale).toMatchObject({ hash: token.hash, settingsUnreadable: false });
    expect(resolveCachedTokenHash(undefined, 1_000, { ok: false }).settingsUnreadable).toBe(true);
    expect(
      authorizeStatusApiBearer({
        authorization: 'Bearer env-token',
        dbTokenHash: null,
        envToken: 'env-token',
        settingsUnreadable: true,
      }),
    ).toEqual({ ok: true });
  });
});

describe('status API summary mapping', () => {
  it('is operational when only disabled components remain', () => {
    const body = buildStatusApiSummary(snapshot(), extras);
    expect(body.status).toBe('operational');
    expect(body.schemaVersion).toBe(1);
    expect(body.service).toMatchObject({ id: 'aihub', name: '示例平台', version: '1.12.0' });
    expect(body.components.find((item) => item.id === 'dependency.database')).toMatchObject({
      group: 'dependency',
      latencyMs: 4,
      name: '数据库',
      status: 'healthy',
    });
    expect(body.components.find((item) => item.id === 'dependency.mail')).toMatchObject({
      name: '邮件服务',
      status: 'disabled',
    });
    expect(body.metrics).toMatchObject({
      dingtalkApiCallsToday: 3,
      dingtalkApiDailyThreshold: 5000,
      instances: { live: 2, offline: 1 },
      jobs: { active: 2, failed: 1 },
      runtimeErrors24h: 0,
    });
    expect(body.incidents).toEqual([]);
  });

  it('is an outage when the database or redis is unavailable, and degraded otherwise', () => {
    expect(
      buildStatusApiSummary(
        snapshot({
          dependencies: {
            database: dependency('unavailable'),
            keyManagement: dependency('healthy'),
            mail: dependency('disabled'),
            objectStorage: dependency('healthy'),
            redis: dependency('healthy'),
          },
        }),
        extras,
      ).status,
    ).toBe('outage');
    expect(
      buildStatusApiSummary(
        snapshot({
          dependencies: {
            database: dependency('healthy'),
            keyManagement: dependency('healthy'),
            mail: dependency('disabled'),
            objectStorage: dependency('healthy'),
            redis: dependency('unavailable'),
          },
        }),
        extras,
      ).status,
    ).toBe('outage');
    const degraded = buildStatusApiSummary(
      snapshot({
        capabilities: [
          { key: 'memory_embedding', reason: '未配置记忆向量模型', status: 'degraded' },
        ],
      }),
      extras,
    );
    expect(degraded.status).toBe('degraded');
    expect(degraded.incidents).toEqual([
      {
        componentId: 'capability.memory_embedding',
        level: 'warning',
        message: '未配置记忆向量模型',
        since: null,
      },
    ]);
    expect(
      buildUnknownStatusApiSummary({
        checkedAt,
        instanceId: 'unknown',
        siteName: '平台',
        url: '',
      }).status,
    ).toBe('unknown');
  });

  it('maps a recent runtime spike and a ding-talk budget overrun without raw stacks', () => {
    const body = buildStatusApiSummary(
      snapshot({
        runtimeErrors: [
          {
            count24h: 4,
            lastAt: new Date(checkedAt.getTime() - 60_000),
            lastError: 'Error: boom\n    at secret (token=abc)',
            subsystem: 'dingtalk_api',
          },
          {
            count24h: 9,
            lastAt: new Date(checkedAt.getTime() - 2 * 60 * 60 * 1000),
            lastError: 'old failure',
            subsystem: 'memory',
          },
        ],
      }),
      { ...extras, callsToday: 5000, threshold: 5000 },
    );
    expect(body.components.find((item) => item.id === 'runtime.dingtalk_api')).toMatchObject({
      group: 'runtime',
      name: '钉钉接口',
      status: 'unavailable',
    });
    expect(body.components.some((item) => item.id === 'runtime.memory')).toBe(false);
    expect(body.metrics.runtimeErrors24h).toBe(13);
    expect(JSON.stringify(body)).not.toContain('token=abc');
    expect(body.components.find((item) => item.id === 'budget.dingtalk_api')).toMatchObject({
      group: 'budget',
      name: '钉钉接口今日调用量',
      status: 'degraded',
    });
    expect(body.incidents.map((item) => item.componentId)).toEqual([
      'runtime.dingtalk_api',
      'budget.dingtalk_api',
    ]);
    expect(body.incidents.every((item) => item.since === null)).toBe(true);
    const since = new Map([['spike:dingtalk_api', '2026-09-24T00:00:00.000Z']]);
    const dated = buildStatusApiSummary(
      snapshot({
        runtimeErrors: [
          {
            count24h: 1,
            lastAt: new Date(checkedAt.getTime() - 60_000),
            lastError: 'boom',
            subsystem: 'dingtalk_api',
          },
        ],
      }),
      { ...extras, incidentSince: since },
    );
    expect(dated.incidents.find((item) => item.componentId === 'runtime.dingtalk_api')?.since).toBe(
      '2026-09-24T00:00:00.000Z',
    );
    const duplicated = buildStatusApiSummary(
      snapshot({
        capabilities: [{ key: 'sandbox', status: 'unavailable', reason: '沙箱不可用' }],
        dependencies: { sandbox: dependency('unavailable') },
      }),
      extras,
    );
    expect(duplicated.components.filter((item) => item.id.endsWith('sandbox'))).toEqual([
      expect.objectContaining({ id: 'dependency.sandbox' }),
    ]);
  });
});

describe('status API events', () => {
  const events = [
    { at: 3_000, level: 'error' as const, message: 'newest', subsystem: 'memory' },
    { at: 2_000, level: 'warning' as const, message: 'middle', subsystem: 'sandbox' },
    { at: 1_000, level: 'info' as const, message: 'oldest', subsystem: 'market' },
  ];

  it('returns newest first, honors an exclusive since, and applies limit', () => {
    expect(parseStatusEventsQuery(new URLSearchParams())).toEqual({ limit: 50, since: null });
    expect(
      parseStatusEventsQuery(new URLSearchParams('limit=10&since=2026-09-25T00:00:00.000Z')),
    ).toEqual({
      limit: 10,
      since: Date.parse('2026-09-25T00:00:00.000Z'),
    });
    const invalidQuery = (raw: string) => {
      const parsed = parseStatusEventsQuery(new URLSearchParams(raw));
      if (!('error' in parsed)) throw new Error(`expected invalid_request for ${raw}`);
      return parsed;
    };
    expect(invalidQuery('limit=0').error).toBe('invalid_request');
    expect(invalidQuery('limit=201').error).toBe('invalid_request');
    expect(invalidQuery('since=not-a-date').error).toBe('invalid_request');

    const page = buildStatusApiEvents(events, { limit: 2, since: 1_000 });
    expect(page.events.map((event) => event.message)).toEqual(['newest', 'middle']);
    expect(statusEventComponentId('dependency:database')).toBe('dependency.database');
    expect(statusEventComponentId('budget:dingtalk_api')).toBe('budget.dingtalk_api');
    expect(statusEventComponentId('spike:market')).toBe('runtime.market');
    expect(statusEventComponentId('memory')).toBe('runtime.memory');
    expect(page.events[0]).toMatchObject({
      componentId: 'runtime.memory',
      level: 'error',
    });
    expect(page.events[0]?.id).toMatch(/^evt_[a-f0-9]{16}$/);
    expect(buildStatusApiEvents(events, { limit: 50, since: 3_000 }).events).toEqual([]);
  });
});

describe('status API summary cache', () => {
  it('reuses an in-process summary for 15 seconds', async () => {
    resetStatusApiSummaryCacheForTest();
    getStatus.mockReset().mockResolvedValue(snapshot());
    const db = {} as LobeChatDatabase;
    await loadStatusApiSummary(db, 1_000);
    await loadStatusApiSummary(db, 1_000 + STATUS_API_SUMMARY_CACHE_MS - 1);
    expect(getStatus).toHaveBeenCalledTimes(1);
    await loadStatusApiSummary(db, 1_000 + STATUS_API_SUMMARY_CACHE_MS);
    expect(getStatus).toHaveBeenCalledTimes(2);
    resetStatusApiSummaryCacheForTest();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    getStatus.mockReset().mockImplementation(async () => {
      await gate;
      return snapshot();
    });
    const first = loadStatusApiSummary(db, 9_000);
    const second = loadStatusApiSummary(db, 9_000);
    release();
    await Promise.all([first, second]);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(buildStatusApiHealth(checkedAt).version).toEqual(expect.any(String));
    resetStatusApiSummaryCacheForTest();
  });
});
