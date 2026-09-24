import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dingtalkApiCallStatsRedisKey,
  formatDingtalkApiCallStatsDate,
  resetDingtalkApiCallStatsForTest,
} from '../dingtalkWorkspace/apiCallStats';
import type { CapabilityReport } from './capabilities';
import {
  collectVerifiedAdminStaffIds,
  deriveAlertComponents,
  DINGTALK_API_BUDGET_ALERT_ID,
  formatStatusAlertLines,
  formatStatusAlertMessage,
  nextAlertState,
  REDIS_UNAVAILABLE_WARN_MS,
  resetStatusAlertsForTest,
  runStatusAlertEvaluation,
  selectAlertTransitions,
  statusAlertLink,
  type StatusAlertSnapshot,
} from './statusAlerts';

const { redisBox } = vi.hoisted(() => ({
  redisBox: {
    current: null as null | {
      batches: string[][];
      failDedup: boolean;
      failLock: boolean;
      hashes: Map<string, Map<string, string>>;
      heldLock: boolean;
    },
  },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisBox.current,
}));

class FakeAlertRedis {
  batches: string[][] = [];
  failDedup = false;
  failLock = false;
  hashes = new Map<string, Map<string, string>>();
  heldLock = false;
  kv = new Map<string, string>();

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    if (key === 'platform:status-alert:lock') {
      if (this.failLock) throw new Error('redis down');
      if (this.heldLock || (args.includes('NX') && this.kv.has(key))) return null;
      this.kv.set(key, value);
      return 'OK';
    }
    if (key.startsWith('platform:status-alert:dedup:')) {
      if (this.failDedup) throw new Error('redis down');
      if (args.includes('NX') && this.kv.has(key)) return null;
      this.kv.set(key, value);
      return 'OK';
    }
    this.kv.set(key, value);
    return 'OK';
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  async eval(_script: string, _count: number, key: string, token: string): Promise<number> {
    if (this.kv.get(key) !== token) return 0;
    this.kv.delete(key);
    return 1;
  }

  multi() {
    const queued: Array<{ args: string[]; cmd: string }> = [];
    const chain = {
      del: (key: string) => {
        queued.push({ args: [key], cmd: 'del' });
        return chain;
      },
      expire: (key: string, seconds: number) => {
        queued.push({ args: [key, String(seconds)], cmd: 'expire' });
        return chain;
      },
      hset: (key: string, field: string, value: string) => {
        queued.push({ args: [key, field, value], cmd: 'hset' });
        return chain;
      },
      exec: async () => {
        this.batches.push(queued.map((op) => op.cmd));
        for (const op of queued) {
          if (op.cmd === 'del') this.hashes.delete(op.args[0] ?? '');
          if (op.cmd === 'hset') {
            const key = op.args[0] ?? '';
            const map = this.hashes.get(key) ?? new Map<string, string>();
            map.set(op.args[1] ?? '', op.args[2] ?? '');
            this.hashes.set(key, map);
          }
        }
        return queued.map(() => [null, 'OK'] as const);
      },
    };
    return chain;
  }
}

const healthyCapability = (key: CapabilityReport['key']): CapabilityReport => ({
  key,
  status: 'healthy',
});

const baseSnapshot = (patch: Partial<StatusAlertSnapshot> = {}): StatusAlertSnapshot => ({
  capabilities: [
    healthyCapability('memory_embedding'),
    healthyCapability('system_agent_models'),
    healthyCapability('dingtalk_connector'),
    healthyCapability('sandbox'),
  ],
  dependencies: {
    database: { status: 'healthy' },
    sandbox: { status: 'healthy' },
  },
  spikes: [],
  workers: [],
  ...patch,
});

describe('status alerts', () => {
  it('builds one Chinese message for a batch and a recovery', () => {
    const broken = deriveAlertComponents(
      baseSnapshot({
        dependencies: {
          database: { status: 'healthy' },
          sandbox: {
            lastError: '沙箱镜像 aihub-sandbox:latest 不存在（拉取策略 never）',
            status: 'unavailable',
          },
        },
        workers: [
          {
            intervalMs: 60_000,
            lastTickAt: null,
            name: 'reminder',
            started: false,
            startedAt: null,
            status: 'unavailable',
          },
        ],
      }),
    );
    const transitions = selectAlertTransitions(new Map(), broken);
    const message = formatStatusAlertMessage(
      transitions,
      'https://aihub.example/admin/system/status',
    );
    expect(message.title).toBe('AIHub 状态告警');
    expect(message.text).toContain(
      '沙箱不可用 — 沙箱镜像 aihub-sandbox:latest 不存在（拉取策略 never）',
    );
    expect(message.text).toContain('提醒任务不可用');
    expect(message.text).toContain('https://aihub.example/admin/system/status');
    expect(message.text.startsWith('AIHub 状态告警：')).toBe(true);

    const previous = nextAlertState(new Map(), broken);
    const back = selectAlertTransitions(previous, deriveAlertComponents(baseSnapshot()));
    expect(
      formatStatusAlertMessage(back, statusAlertLink({ APP_URL: 'https://aihub.example' })).text,
    ).toContain('沙箱已恢复');
  });

  it('labels a DingTalk personal-data outage and stays quiet when the feature is off', () => {
    const down = deriveAlertComponents(
      baseSnapshot({
        capabilities: [
          healthyCapability('memory_embedding'),
          healthyCapability('system_agent_models'),
          healthyCapability('dingtalk_connector'),
          {
            key: 'dingtalk_personal',
            reason: 'aihub-dws 健康检查失败',
            status: 'unavailable',
          },
          healthyCapability('sandbox'),
        ],
      }),
    );
    expect(down.find((item) => item.id === 'capability:dingtalk_personal')).toMatchObject({
      label: '钉钉个人数据',
      status: 'unavailable',
    });

    const off = deriveAlertComponents(
      baseSnapshot({
        capabilities: [
          healthyCapability('memory_embedding'),
          { key: 'dingtalk_personal', reason: '未启用钉钉个人数据', status: 'disabled' },
        ],
      }),
    );
    expect(off.some((item) => item.id === 'capability:dingtalk_personal')).toBe(false);
  });

  it('does not alert a spike that the sandbox tile already covers', () => {
    const components = deriveAlertComponents(
      baseSnapshot({
        dependencies: {
          sandbox: { lastError: '镜像缺失', status: 'unavailable' },
        },
        spikes: [{ errors10m: 5, lastError: '镜像缺失', subsystem: 'sandbox' }],
      }),
    );
    expect(components.some((item) => item.id === 'spike:sandbox')).toBe(false);
    expect(components.some((item) => item.id === 'dependency:sandbox')).toBe(true);
  });

  it('alerts an error spike while the dependency tile is still green', () => {
    const components = deriveAlertComponents(
      baseSnapshot({
        spikes: [{ errors10m: 3, lastError: 'InvalidProviderAPIKey', subsystem: 'memory' }],
      }),
    );
    expect(components.find((item) => item.id === 'spike:memory')).toMatchObject({
      status: 'unavailable',
    });
  });

  it('sends one notice per transition and suppresses the same state for six hours', async () => {
    const seen = new Set<string>();
    const sent: string[] = [];
    const events: string[] = [];
    const snapshot = baseSnapshot({
      dependencies: {
        database: { status: 'healthy' },
        sandbox: {
          lastError: '沙箱镜像 aihub-sandbox:latest 不存在（拉取策略 never）',
          status: 'unavailable',
        },
      },
    });
    const deps = {
      acquireLock: async () => 'acquired' as const,
      claimDedup: async (id: string, state: string) => {
        const key = `${id}:${state}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      },
      enabled: () => true,
      link: () => '/admin/system/status',
      listStaffIds: async () => ['staff-1'],
      loadPrevious: async () => new Map<string, 'healthy' | 'unhealthy'>(),
      loadSnapshot: async () => snapshot,
      recordEvent: async (event: { message: string }) => {
        events.push(event.message);
      },
      releaseLock: async () => undefined,
      saveState: async () => undefined,
      send: async (input: { text: string }) => {
        sent.push(input.text);
      },
    };
    const first = await runStatusAlertEvaluation(deps);
    expect(first.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(events[0]).toContain('沙箱不可用');

    const second = await runStatusAlertEvaluation(deps);
    expect(second.sent).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('does nothing when AIHUB_STATUS_ALERTS=0', async () => {
    const loadSnapshot = vi.fn();
    const result = await runStatusAlertEvaluation({
      enabled: () => false,
      loadSnapshot,
    });
    expect(result).toEqual({ sent: false, transitions: 0 });
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the status-page link and counts transitions that do not fit', () => {
    const link = 'https://aihub.example/admin/system/status';
    const many = Array.from({ length: 13 }, (_, index) => ({
      id: `dependency:z${index}`,
      label: `Z${String(index).padStart(2, '0')}`,
      next: 'unhealthy' as const,
      status: 'unavailable',
    }));
    const short = formatStatusAlertMessage(many, link);
    expect(short.text.endsWith(link)).toBe(true);
    expect(short.text).toContain('另有 1 项异常/恢复，详见状态页');
    expect(short.text).toContain('Z00不可用');
    expect(short.text).toContain('Z11不可用');
    expect(short.text).not.toContain('Z12不可用');
    expect(short.text.length).toBeLessThanOrEqual(1500);

    const long = formatStatusAlertMessage(
      many.map((item) => ({ ...item, detail: 'x'.repeat(280) })),
      link,
    );
    expect(long.text.endsWith(link)).toBe(true);
    expect(long.text).toMatch(/另有 \d+ 项异常\/恢复，详见状态页/);
    expect(long.text).toContain('Z00不可用');
    expect(long.text).not.toContain('Z12不可用');
    expect(long.text.length).toBeLessThanOrEqual(1500);

    const hugeLink = `https://aihub.example/${'a'.repeat(1600)}`;
    const kept = formatStatusAlertMessage([many[0]!], hugeLink);
    expect(kept.text.endsWith(hugeLink)).toBe(true);
  });

  it('alerts only verified DingTalk staff ids, never an identity-email local part', async () => {
    const ids = await collectVerifiedAdminStaffIds(
      ['verified', 'email-only', 'inactive', 'manual', 'throws', 'blank', 'verified'],
      async (userId) => {
        if (userId === 'verified') return { staffId: 'staff-a' };
        if (userId === 'blank') return { staffId: '   ' };
        if (userId === 'email-only' || userId === 'manual') {
          return { error: 'DINGTALK_IDENTITY_UNVERIFIED' };
        }
        if (userId === 'inactive') return { error: 'DINGTALK_IDENTITY_INACTIVE' };
        throw new Error(`lookup failed for Staff-C@dingtalk.jiefakj.com`);
      },
    );
    expect(ids).toEqual(['staff-a']);

    const capped = await collectVerifiedAdminStaffIds(
      Array.from({ length: 101 }, (_, index) => `user-${index}`),
      async (userId) => ({ staffId: `staff-${userId}` }),
    );
    expect(capped).toHaveLength(100);
    expect(capped).not.toContain('staff-user-100');
  });
});

describe('status alert redis gate', () => {
  let redis: FakeAlertRedis;
  const link = '/admin/system/status';
  const broken = baseSnapshot({
    dependencies: {
      database: { status: 'healthy' },
      sandbox: { lastError: '沙箱镜像缺失', status: 'unavailable' },
    },
  });

  const warnLines = (warn: { mock: { calls: unknown[][] } }): unknown[][] =>
    warn.mock.calls.filter((args) => String(args[0]).includes('redis unavailable'));

  beforeEach(() => {
    resetStatusAlertsForTest();
    resetDingtalkApiCallStatsForTest();
    redis = new FakeAlertRedis();
    redisBox.current = redis;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    redisBox.current = null;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('does not send when the shared lock is missing or already held', async () => {
    const send = vi.fn();
    const loadSnapshot = vi.fn(async () => broken);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_700_000_000_000);
    redisBox.current = null;

    await runStatusAlertEvaluation({ enabled: () => true, link: () => link, loadSnapshot, send });
    await runStatusAlertEvaluation({ enabled: () => true, link: () => link, loadSnapshot, send });
    expect(send).not.toHaveBeenCalled();
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(warnLines(warn)).toHaveLength(1);

    now.mockReturnValue(1_700_000_000_000 + REDIS_UNAVAILABLE_WARN_MS);
    await runStatusAlertEvaluation({ enabled: () => true, link: () => link, loadSnapshot, send });
    expect(warnLines(warn)).toHaveLength(2);

    resetStatusAlertsForTest();
    redis = new FakeAlertRedis();
    redis.failLock = true;
    redisBox.current = redis;
    now.mockReturnValue(1_700_000_000_000 + REDIS_UNAVAILABLE_WARN_MS * 2);
    await runStatusAlertEvaluation({ enabled: () => true, link: () => link, loadSnapshot, send });
    expect(loadSnapshot).not.toHaveBeenCalled();
    expect(warnLines(warn)).toHaveLength(3);

    resetStatusAlertsForTest();
    redis = new FakeAlertRedis();
    redis.heldLock = true;
    redisBox.current = redis;
    warn.mockClear();
    await runStatusAlertEvaluation({ enabled: () => true, link: () => link, loadSnapshot, send });
    expect(send).not.toHaveBeenCalled();
    expect(warnLines(warn)).toHaveLength(0);

    warn.mockRestore();
    now.mockRestore();
  });

  it('does not send when shared dedup errors, and retries that transition later', async () => {
    const send = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    redis.failDedup = true;
    redis.hashes.set('platform:status-alert:state', new Map([['dependency:ghost', 'unhealthy']]));
    await runStatusAlertEvaluation({
      enabled: () => true,
      link: () => link,
      listStaffIds: async () => ['staff-1'],
      loadSnapshot: async () => broken,
      recordEvent: async () => undefined,
      send,
    });
    expect(send).not.toHaveBeenCalled();
    expect(redis.hashes.get('platform:status-alert:state')?.has('dependency:ghost')).toBe(true);
    expect(redis.batches).toEqual([]);
    expect(warnLines(warn)).toHaveLength(1);

    redis.failDedup = false;
    await runStatusAlertEvaluation({
      enabled: () => true,
      link: () => link,
      listStaffIds: async () => ['staff-1'],
      loadSnapshot: async () => broken,
      recordEvent: async () => undefined,
      send,
    });
    expect(send).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('replaces the state hash so a disappeared component does not raise a false recovery', async () => {
    const sent: string[] = [];
    redis.hashes.set(
      'platform:status-alert:state',
      new Map([
        ['dependency:ghost', 'unhealthy'],
        ['dependency:sandbox', 'unhealthy'],
      ]),
    );
    const run = (snapshot: StatusAlertSnapshot) =>
      runStatusAlertEvaluation({
        enabled: () => true,
        link: () => link,
        listStaffIds: async () => ['staff-1'],
        loadSnapshot: async () => snapshot,
        recordEvent: async () => undefined,
        send: async (input: { text: string }) => {
          sent.push(input.text);
        },
      });

    await run(broken);
    const state = redis.hashes.get('platform:status-alert:state');
    expect(state?.has('dependency:ghost')).toBe(false);
    expect(state?.get('dependency:sandbox')).toBe('unhealthy');
    expect(redis.batches[0]?.[0]).toBe('del');
    expect(redis.batches[0]).toContain('hset');
    expect(redis.batches[0]?.indexOf('del')).toBeLessThan(redis.batches[0]?.indexOf('hset') ?? -1);

    await run(baseSnapshot({ dependencies: { database: { status: 'healthy' } } }));
    expect(redis.hashes.get('platform:status-alert:state')?.has('dependency:sandbox')).toBe(false);

    await run(
      baseSnapshot({
        dependencies: {
          database: { status: 'healthy' },
          sandbox: { status: 'healthy' },
        },
      }),
    );
    expect(sent.some((text) => text.includes('沙箱已恢复'))).toBe(false);
  });

  it('alerts when today exceeds the threshold, dedupes, and recovers once under it', async () => {
    const date = formatDingtalkApiCallStatsDate(new Date());
    const key = dingtalkApiCallStatsRedisKey(date);
    redis.hashes.set(
      key,
      new Map([
        ['GET /c', '300'],
        ['GET /d', '150'],
        ['GET /f', '40'],
        ['POST /a', '4000'],
        ['POST /b', '500'],
        ['POST /e', '80'],
      ]),
    );
    const sent: string[] = [];
    const run = () =>
      runStatusAlertEvaluation({
        enabled: () => true,
        link: () => '/admin/system/status',
        listStaffIds: async () => ['staff-1'],
        loadSnapshot: async () => baseSnapshot(),
        recordEvent: async () => undefined,
        send: async (input: { text: string }) => {
          sent.push(input.text);
        },
      });

    const first = await run();
    expect(first.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('钉钉 API 今日调用量超出告警阈值');
    expect(sent[0]).toContain('今日 API 调用 5070 次，超过告警阈值 5000');
    expect(sent[0]).toContain('POST /a 4000 次');
    expect(sent[0]).toContain('POST /e 80 次');
    expect(sent[0]).not.toContain('GET /f');

    const again = await run();
    expect(again.sent).toBe(false);
    expect(sent).toHaveLength(1);

    redis.hashes.delete('platform:status-alert:state');
    const deduped = await run();
    expect(deduped.sent).toBe(false);
    expect(sent).toHaveLength(1);
    expect(
      redis.kv.has(`platform:status-alert:dedup:${DINGTALK_API_BUDGET_ALERT_ID}:unhealthy`),
    ).toBe(true);

    redis.hashes.set(key, new Map([['POST /a', '10']]));
    const recovered = await run();
    expect(recovered.sent).toBe(true);
    expect(sent.at(-1)).toContain('钉钉 API 今日调用量已回落到告警阈值以下');
    expect(
      redis.hashes.get('platform:status-alert:state')?.get(`${DINGTALK_API_BUDGET_ALERT_ID}:day`),
    ).toBe(date);
  });

  it('does not send a recovery when the budget counter resets on a new day', async () => {
    redis.hashes.set(
      'platform:status-alert:state',
      new Map([
        [DINGTALK_API_BUDGET_ALERT_ID, 'unhealthy'],
        [`${DINGTALK_API_BUDGET_ALERT_ID}:day`, '2000-01-01'],
      ]),
    );
    const today = formatDingtalkApiCallStatsDate(new Date());
    redis.hashes.set(dingtalkApiCallStatsRedisKey(today), new Map([['POST /a', '1']]));
    const sent: string[] = [];
    const result = await runStatusAlertEvaluation({
      enabled: () => true,
      link: () => '/admin/system/status',
      listStaffIds: async () => ['staff-1'],
      loadSnapshot: async () => baseSnapshot(),
      recordEvent: async () => undefined,
      send: async (input: { text: string }) => {
        sent.push(input.text);
      },
    });
    expect(result).toEqual({ sent: false, transitions: 0 });
    expect(sent).toHaveLength(0);
    expect(redis.hashes.get('platform:status-alert:state')?.get(DINGTALK_API_BUDGET_ALERT_ID)).toBe(
      'healthy',
    );
    expect(
      redis.kv.has(`platform:status-alert:dedup:${DINGTALK_API_BUDGET_ALERT_ID}:healthy`),
    ).toBe(false);
    expect(
      formatStatusAlertLines([
        {
          day: today,
          id: DINGTALK_API_BUDGET_ALERT_ID,
          label: '钉钉 API 今日调用量',
          next: 'healthy',
          previous: 'unhealthy',
          previousDay: '2000-01-01',
          status: 'healthy',
        },
      ]),
    ).toEqual([]);
  });

  it('stays quiet under the threshold and when the alert is disabled', async () => {
    const key = dingtalkApiCallStatsRedisKey(formatDingtalkApiCallStatsDate(new Date()));
    redis.hashes.set(key, new Map([['POST /a', '4999']]));
    const send = vi.fn();
    const under = await runStatusAlertEvaluation({
      enabled: () => true,
      link: () => '/admin/system/status',
      listStaffIds: async () => ['staff-1'],
      loadSnapshot: async () => baseSnapshot(),
      send,
    });
    expect(under).toEqual({ sent: false, transitions: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(redis.hashes.get('platform:status-alert:state')?.get(DINGTALK_API_BUDGET_ALERT_ID)).toBe(
      'healthy',
    );

    resetStatusAlertsForTest();
    redis.hashes.clear();
    redis.kv.clear();
    redis.hashes.set(key, new Map([['POST /a', '5000']]));
    const atThreshold = vi.fn();
    const exact = await runStatusAlertEvaluation({
      enabled: () => true,
      link: () => '/admin/system/status',
      listStaffIds: async () => ['staff-1'],
      loadSnapshot: async () => baseSnapshot(),
      send: atThreshold,
    });
    expect(exact.sent).toBe(true);
    expect(String(atThreshold.mock.calls[0]?.[0]?.text)).toContain('今日 API 调用 5000 次');

    resetStatusAlertsForTest();
    redis.hashes.clear();
    redis.kv.clear();
    vi.stubEnv('DINGTALK_API_DAILY_ALERT_THRESHOLD', '0');
    redis.hashes.set(key, new Map([['POST /a', '90000']]));
    const disabled = await runStatusAlertEvaluation({
      enabled: () => true,
      link: () => '/admin/system/status',
      listStaffIds: async () => ['staff-1'],
      loadSnapshot: async () => baseSnapshot(),
      send,
    });
    expect(disabled).toEqual({ sent: false, transitions: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(redis.hashes.get('platform:status-alert:state')?.has(DINGTALK_API_BUDGET_ALERT_ID)).toBe(
      false,
    );
  });
});
