// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = vi.hoisted(() => `svc-${'t'.repeat(32)}`);
const harness = vi.hoisted(() => {
  const state = {
    claimGate: null as Promise<void> | null,
    displaced: [] as Array<{ id: string; profile: string; userId: string }>,
    events: [] as string[],
    forceRevokeMiss: false,
    otherActive: false,
    ownershipGate: null as Promise<void> | null,
    revokeAfterRead: false,
    row: null as null | Record<string, any>,
    upsertOpts: undefined as { loginStartedAt?: Date; onlyIfNotRevoked?: boolean } | undefined,
    upserts: 0,
  };
  const applyActive = (input: Record<string, unknown>) => {
    state.upserts += 1;
    const previous = state.row;
    state.row = {
      ...previous,
      authorizedAt:
        previous?.status === 'active'
          ? previous.authorizedAt
          : new Date('2026-09-24T03:00:00.000Z'),
      id: previous?.id ?? 'dpa_1',
      lastErrorCode: null,
      status: 'active',
      userId: 'user-a',
      ...input,
    };
    return state.row;
  };
  return {
    applyActive,
    audit: vi.fn(),
    findByPlatform: vi.fn(),
    invalidateWorkspaceTodos: vi.fn(),
    redis: { current: null as FakeRedis | null },
    requireSubject: vi.fn(),
    resolve: vi.fn(),
    state,
    stopWatch: vi.fn(),
    watch: vi.fn(),
  };
});

vi.mock('@/envs/dingtalkPersonal', () => ({
  dingtalkPersonalEnv: {
    DINGTALK_PERSONAL_BROKER_TOKEN: TOKEN,
    DINGTALK_PERSONAL_BROKER_URL: 'http://aihub-dws:8080',
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => ({}),
}));

vi.mock('@/database/models/systemBotProvider', () => ({
  SystemBotProviderModel: {
    findByPlatform: (...args: unknown[]) => harness.findByPlatform(...args),
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => undefined },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => harness.redis.current,
}));

vi.mock('@/database/models/dingtalkPersonalAuthorization', () => ({
  DingtalkPersonalAuthorizationModel: class {
    findMine = async () => {
      const row = harness.state.row;
      if (harness.state.revokeAfterRead && row) {
        harness.state.revokeAfterRead = false;
        harness.state.row = { ...row, status: 'revoked' };
        return row;
      }
      return row;
    };
    upsertActive = async (
      input: Record<string, unknown>,
      opts?: { loginStartedAt?: Date; onlyIfNotRevoked?: boolean },
    ) => {
      harness.state.upsertOpts = opts;
      if (opts?.onlyIfNotRevoked && harness.state.row?.status === 'revoked') return null;
      return harness.applyActive(input);
    };
    claimActiveProfile = async (input: Record<string, unknown>) => {
      harness.state.events.push('claim');
      const gate = harness.state.claimGate;
      if (gate) {
        await gate;
        harness.state.otherActive = true;
      }
      harness.state.events.push('claim-done');
      const displaced = harness.state.displaced;
      harness.state.displaced = [];
      return { displaced, row: harness.applyActive(input) };
    };
    hasOtherActiveProfile = async () => {
      harness.state.events.push('check');
      const gate = harness.state.ownershipGate;
      if (gate) await gate;
      harness.state.events.push('check-done');
      return harness.state.otherActive;
    };
    markExpired = async (code?: string) => {
      if (!harness.state.row || harness.state.row.status === 'revoked') return;
      harness.state.row = { ...harness.state.row, lastErrorCode: code ?? null, status: 'expired' };
    };
    markRevoked = async () => {
      harness.state.events.push('markRevoked');
      if (harness.state.forceRevokeMiss) return false;
      if (!harness.state.row || harness.state.row.status === 'revoked') return false;
      harness.state.row = { ...harness.state.row, status: 'revoked' };
      return true;
    };
    touchChecked = async () => undefined;
    touchLastUsed = async () => undefined;
  },
}));

vi.mock('./audit', () => ({
  appendDingtalkPersonalAudit: (...args: unknown[]) => harness.audit(...args),
}));

vi.mock('./identity', () => ({
  requireDingtalkPersonalSubject: (...args: unknown[]) => harness.requireSubject(...args),
  resolveDingtalkPersonalSubject: (...args: unknown[]) => harness.resolve(...args),
  splitDingtalkPersonalProfile: (profile: string) => {
    const index = profile.indexOf(':');
    if (index <= 0 || index !== profile.lastIndexOf(':')) return null;
    const corpId = profile.slice(0, index);
    const staffId = profile.slice(index + 1);
    if (!corpId || !staffId) return null;
    return { corpId, staffId };
  },
}));

vi.mock('@/server/enterprise/services/dingtalkWorkspace/todo', () => ({
  invalidateDingtalkTodoListCache: (...args: unknown[]) =>
    harness.invalidateWorkspaceTodos(...args),
}));

vi.mock('./loginWatcher', () => ({
  stopDingtalkPersonalLoginWatch: (...args: unknown[]) => harness.stopWatch(...args),
  watchDingtalkPersonalLogin: (...args: unknown[]) => harness.watch(...args),
}));

class FakeRedis {
  readonly store = new Map<string, { expiresAt: number; value: string }>();

  private live(key: string) {
    const row = this.store.get(key);
    if (!row || row.expiresAt <= Date.now()) {
      if (row) this.store.delete(key);
      return undefined;
    }
    return row;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, mode?: string, ttl?: number, nx?: string) {
    if ((nx === 'NX' || mode === 'NX') && this.live(key)) return null;
    const expiresAt =
      mode === 'PX' && typeof ttl === 'number'
        ? Date.now() + ttl
        : mode === 'EX' && typeof ttl === 'number'
          ? Date.now() + ttl * 1000
          : Number.POSITIVE_INFINITY;
    this.store.set(key, { expiresAt, value });
    return 'OK';
  }

  async eval(_script: string, numKeys: number, key: string, token: string) {
    if (numKeys !== 1 || (await this.get(key)) !== token) return 0;
    await this.del(key);
    return 1;
  }

  async incr(key: string) {
    const next = Number(this.live(key)?.value ?? '0') + 1;
    const existing = this.live(key);
    this.store.set(key, {
      expiresAt: existing?.expiresAt ?? Number.POSITIVE_INFINITY,
      value: String(next),
    });
    return next;
  }

  async expire(key: string, ttl: number) {
    const row = this.live(key);
    if (!row) return 0;
    row.expiresAt = Date.now() + ttl * 1000;
    return 1;
  }

  async del(...keys: string[]) {
    let count = 0;
    for (const key of keys) if (this.store.delete(key)) count += 1;
    return count;
  }
}

const { DingtalkPersonalService, finalizeDingtalkPersonalLogin } = await import('./service');
const { resetDingtalkPersonalConfigForTest } = await import('./config');
const { dingtalkPersonalProfileLockDepthForTest, resetDingtalkPersonalProfileLockForTest } =
  await import('./profileLock');
const { readDingtalkPersonalCache, resetDingtalkPersonalCacheForTest, writeDingtalkPersonalCache } =
  await import('./cache');
const { resetDingtalkPersonalLoginStoreForTest } = await import('./loginStore');

const SUBJECT = {
  corpId: 'dingcorp',
  ok: true as const,
  profile: 'dingcorp:staff1',
  staffId: 'staff1',
  userName: '甲',
};

const VERIFICATION_URL = 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=JCHB-KBXF';

const allOn = {
  personalChatEnabled: true,
  personalDataEnabled: true,
  personalReportEnabled: true,
  personalTodoEnabled: true,
  personalWriteEnabled: true,
};

const activeRow = () => ({
  authorizedAt: new Date('2026-09-24T00:00:00.000Z'),
  corpId: 'dingcorp',
  corpName: '示例公司',
  dingtalkUserName: '甲',
  id: 'dpa_1',
  lastCheckedAt: null,
  lastErrorCode: null,
  lastUsedAt: null,
  profile: 'dingcorp:staff1',
  staffId: 'staff1',
  status: 'active',
  userId: 'user-a',
});

describe('DingtalkPersonalService', () => {
  const fetchMock = vi.fn();
  const script = {
    exec: { ok: true, data: { todos: [] } } as unknown,
    cancel: { ok: true, status: 'cancelled' } as Record<string, unknown>,
    cancelSawMarker: false,
    login: {
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      jobId: 'job-owner-a',
      status: 'pending',
      userCode: 'JCHB-KBXF',
      verificationUrl: VERIFICATION_URL,
    } as Record<string, unknown>,
  };

  const service = new DingtalkPersonalService({} as never, 'user-a');
  const other = new DingtalkPersonalService({} as never, 'user-b');

  const installFetch = () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/v1/exec') && method === 'POST') {
        return Response.json(script.exec);
      }
      if (url.endsWith('/v1/login') && method === 'POST')
        return Response.json(script.login, { status: 201 });
      if (url.includes('/v1/login/') && method === 'DELETE') {
        const { isDingtalkPersonalLoginCancelled } = await import('./loginStore');
        const jobId = decodeURIComponent(String(url).split('/v1/login/')[1] ?? '');
        script.cancelSawMarker = await isDingtalkPersonalLoginCancelled(jobId);
        return Response.json(script.cancel);
      }
      if (url.includes('/v1/login/')) return Response.json(script.login);
      if (url.includes('/v1/profiles/') && url.endsWith('/status')) {
        return Response.json({
          authenticated: true,
          corpName: '示例公司',
          tokenValid: true,
          userName: '甲',
        });
      }
      if (url.includes('/v1/profiles/') && method === 'DELETE') {
        harness.state.events.push('delete');
        return Response.json({ ok: true, removed: true });
      }
      return Response.json(
        { error: { code: 'LOGIN_NOT_FOUND', message: 'missing' } },
        { status: 404 },
      );
    });
  };

  const execBodies = () =>
    fetchMock.mock.calls
      .filter((call) => String(call[0]).endsWith('/v1/exec'))
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)));

  beforeEach(() => {
    harness.audit.mockReset();
    harness.invalidateWorkspaceTodos.mockReset();
    harness.watch.mockReset();
    harness.stopWatch.mockReset();
    harness.findByPlatform.mockReset();
    harness.resolve.mockReset();
    harness.requireSubject.mockReset();
    harness.state.row = activeRow();
    harness.state.upserts = 0;
    harness.state.displaced = [];
    harness.state.events = [];
    harness.state.claimGate = null;
    harness.state.ownershipGate = null;
    harness.state.otherActive = false;
    harness.state.revokeAfterRead = false;
    harness.state.forceRevokeMiss = false;
    harness.state.upsertOpts = undefined;
    harness.redis.current = new FakeRedis();
    harness.resolve.mockResolvedValue(SUBJECT);
    harness.requireSubject.mockResolvedValue(SUBJECT);
    harness.findByPlatform.mockResolvedValue({ settings: { ...allOn } });
    harness.audit.mockResolvedValue(undefined);
    script.exec = { data: { todos: [] }, ok: true };
    script.login = {
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      jobId: 'job-owner-a',
      status: 'pending',
      userCode: 'JCHB-KBXF',
      verificationUrl: VERIFICATION_URL,
    };
    script.cancel = { ok: true, status: 'cancelled' };
    script.cancelSawMarker = false;
    resetDingtalkPersonalConfigForTest();
    resetDingtalkPersonalCacheForTest();
    resetDingtalkPersonalLoginStoreForTest();
    resetDingtalkPersonalProfileLockForTest();
    fetchMock.mockReset();
    installFetch();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('returns disabled without resolving identity, and does not call the broker for getStatus', async () => {
    harness.findByPlatform.mockResolvedValue({
      settings: { ...allOn, personalDataEnabled: false },
    });
    resetDingtalkPersonalConfigForTest();
    await expect(service.getStatus()).resolves.toEqual({ state: 'disabled' });
    expect(harness.resolve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads an active row without calling the broker, and checkStatus follows the broker', async () => {
    await expect(service.getStatus()).resolves.toMatchObject({
      corpName: '示例公司',
      dingtalkUserName: '甲',
      features: { chat: true, docs: false, report: true, sheets: false, todo: true, write: true },
      state: 'authorized',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const checked = await service.checkStatus();
    expect(checked.state).toBe('authorized');
    expect(harness.state.upsertOpts).toEqual({ onlyIfNotRevoked: true });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/status'))).toBe(true);

    fetchMock.mockImplementation(async () => Response.json({ authenticated: false }));
    await expect(service.checkStatus()).resolves.toMatchObject({
      lastErrorCode: 'NOT_AUTHORIZED',
      state: 'expired',
    });
    expect(harness.state.row?.status).toBe('expired');
  });

  it('reports identity failures and a missing corp id', async () => {
    harness.resolve.mockResolvedValue({ code: 'DINGTALK_IDENTITY_UNVERIFIED', ok: false });
    await expect(service.getStatus()).resolves.toEqual({
      code: 'DINGTALK_IDENTITY_UNVERIFIED',
      state: 'identity_required',
    });
    harness.resolve.mockResolvedValue({ code: 'DINGTALK_PERSONAL_CORP_ID_MISSING', ok: false });
    await expect(service.getStatus()).resolves.toEqual({
      code: 'DINGTALK_PERSONAL_CORP_ID_MISSING',
      state: 'identity_required',
    });
  });

  it('gates exec on the feature switch, the write switch, and the authorization row', async () => {
    harness.findByPlatform.mockResolvedValue({
      settings: { ...allOn, personalTodoEnabled: false },
    });
    resetDingtalkPersonalConfigForTest();
    await expect(service.exec('todo.list', {})).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_FEATURE_DISABLED',
      details: { feature: 'todo' },
    });
    expect(harness.requireSubject).not.toHaveBeenCalled();

    harness.findByPlatform.mockResolvedValue({
      settings: { ...allOn, personalWriteEnabled: false },
    });
    resetDingtalkPersonalConfigForTest();
    await expect(service.exec('todo.update', { taskId: 't1', title: '改' })).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_FEATURE_DISABLED',
      details: { feature: 'write' },
    });
    await expect(service.exec('contact.self', {})).resolves.toEqual({ todos: [] });

    harness.state.row = null;
    await expect(service.exec('contact.self', {})).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_UNAUTHORIZED',
    });
    harness.state.row = { ...activeRow(), status: 'expired' };
    await expect(service.exec('contact.self', {})).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_EXPIRED',
    });
    harness.state.row = { ...activeRow(), profile: 'dingcorp:someone-else' };
    await expect(service.exec('contact.self', {})).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_UNAUTHORIZED',
    });
  });

  it('rejects downloads inside exec and downloads a drive file through downloadOp', async () => {
    await expect(service.exec('chat.downloadFile', { resourceId: 'file-1' })).rejects.toMatchObject(
      {
        code: 'DINGTALK_PERSONAL_INVALID_ARGS',
      },
    );
    expect(execBodies()).toHaveLength(0);

    await expect(
      service.downloadOp('drive.download', { nodeId: 'n1', output: './files/' }),
    ).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_FEATURE_DISABLED',
      details: { feature: 'docs' },
    });
    expect(execBodies()).toHaveLength(0);

    harness.findByPlatform.mockResolvedValue({
      settings: { ...allOn, personalDocsEnabled: true },
    });
    resetDingtalkPersonalConfigForTest();
    await expect(service.exec('drive.download', { nodeId: 'n1' })).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_INVALID_ARGS',
    });
    expect(execBodies()).toHaveLength(0);

    script.exec = {
      file: {
        contentBase64: Buffer.from('hello').toString('base64'),
        name: '报价.xlsx',
        sizeBytes: 99,
      },
      ok: true,
    };
    const file = await service.downloadOp('drive.download', { nodeId: 'n1', output: './files/' });
    expect(file.buffer.toString()).toBe('hello');
    expect(file.name).toBe('报价.xlsx');
    expect(file.sizeBytes).toBe(5);
    expect(execBodies()[0]).toEqual({
      actor: 'user-a',
      args: { nodeId: 'n1', output: './files/' },
      op: 'drive.download',
      profile: 'dingcorp:staff1',
    });

    script.exec = { error: { code: 'NOT_AUTHORIZED', message: 'gone' }, ok: false };
    await expect(
      service.downloadOp('drive.download', { nodeId: 'n1', output: './files/' }),
    ).rejects.toMatchObject({ code: 'DINGTALK_PERSONAL_EXPIRED' });
    expect(harness.state.row).toMatchObject({ lastErrorCode: 'NOT_AUTHORIZED', status: 'expired' });
  });

  it('sends only the server-derived profile and strips a caller profile', async () => {
    await service.exec('todo.list', { profile: 'evil:person', status: 'open' });
    expect(execBodies()[0]).toEqual({
      actor: 'user-a',
      args: { status: 'open' },
      op: 'todo.list',
      profile: 'dingcorp:staff1',
    });
    const header = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(header.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('marks the row expired when the broker says the profile is not authorized', async () => {
    script.exec = { error: { code: 'NOT_AUTHORIZED', message: `token=${TOKEN}` }, ok: false };
    try {
      await service.exec('todo.list', {});
      throw new Error('expected expired');
    } catch (error) {
      expect(error).toMatchObject({ code: 'DINGTALK_PERSONAL_EXPIRED' });
      expect(
        `${error instanceof Error ? error.message : ''} ${JSON.stringify(error)}`,
      ).not.toContain(TOKEN);
    }
    expect(harness.state.row).toMatchObject({ lastErrorCode: 'NOT_AUTHORIZED', status: 'expired' });
  });

  it('rate limits after 60 calls and serves repeated reads from cache', async () => {
    for (let i = 0; i < 60; i += 1) await service.exec('todo.list', { status: 'open' });
    expect(execBodies()).toHaveLength(1);
    await expect(service.exec('todo.list', { status: 'open' })).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_RATE_LIMITED',
    });
    expect(execBodies()).toHaveLength(1);
  });

  it('lets writes bypass the read cache and invalidate it', async () => {
    await service.exec('todo.list', { status: 'open' });
    await service.exec('todo.complete', { taskId: 'task-1' });
    await service.exec('todo.list', { status: 'open' });
    const bodies = execBodies();
    expect(bodies.map((body) => body.op)).toEqual(['todo.list', 'todo.complete', 'todo.list']);
    expect(bodies.every((body) => body.profile === 'dingcorp:staff1')).toBe(true);
    expect(harness.invalidateWorkspaceTodos).toHaveBeenCalledTimes(1);
    expect(harness.invalidateWorkspaceTodos).toHaveBeenCalledWith('user-a');
  });

  it('charges one rate-limit token for a todo batch and invalidates caches once', async () => {
    const { readDingtalkPersonalCache, writeDingtalkPersonalCache } = await import('./cache');
    await writeDingtalkPersonalCache('user-a', 'todo.list', { status: 'open' }, { n: 1 });
    await service.beginTodoBatch();
    await expect(
      readDingtalkPersonalCache('user-a', 'todo.list', { status: 'open' }),
    ).resolves.toBeUndefined();

    await writeDingtalkPersonalCache('user-a', 'todo.list', { status: 'open' }, { n: 2 });
    await service.exec(
      'todo.complete',
      { taskId: 'a' },
      { skipCacheInvalidation: true, skipRateLimit: true },
    );
    await service.exec(
      'todo.complete',
      { taskId: 'b' },
      { skipCacheInvalidation: true, skipRateLimit: true },
    );
    await expect(
      readDingtalkPersonalCache('user-a', 'todo.list', { status: 'open' }),
    ).resolves.toEqual({ n: 2 });
    expect(harness.invalidateWorkspaceTodos).not.toHaveBeenCalled();

    await service.commitTodoBatch();
    await expect(
      readDingtalkPersonalCache('user-a', 'todo.list', { status: 'open' }),
    ).resolves.toBeUndefined();
    expect(harness.invalidateWorkspaceTodos).toHaveBeenCalledTimes(1);
    expect(execBodies().map((body) => body.op)).toEqual(['todo.complete', 'todo.complete']);

    const redis = harness.redis.current;
    const rateKey = [...(redis?.store.keys() ?? [])].find((key) =>
      key.startsWith('dingtalk-personal:rl:'),
    );
    expect(rateKey).toBeTruthy();
    expect(redis?.store.get(rateKey ?? '')?.value).toBe('1');
  });

  it('invalidates the workspace todo list only after a personal todo write', async () => {
    await service.exec('todo.update', { taskId: 'task-1', title: '改' });
    await service.exec('report.submit', { contents: [], templateId: 'tpl', toUserIds: ['s'] });
    await service.exec('todo.list', {});
    expect(harness.invalidateWorkspaceTodos.mock.calls).toEqual([['user-a']]);
  });

  it('does not cache a read that overlaps a cache invalidation', async () => {
    let started!: () => void;
    const startedGate = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const releaseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/v1/exec')) {
        started();
        await releaseGate;
        return Response.json({ data: { todos: [{ taskId: 'stale' }] }, ok: true });
      }
      return Response.json({ ok: true, removed: true });
    });

    const pending = service.exec('todo.list', { status: 'open' });
    await startedGate;
    const { invalidateDingtalkPersonalCache } = await import('./cache');
    await invalidateDingtalkPersonalCache('user-a');
    release();
    await expect(pending).resolves.toEqual({ todos: [{ taskId: 'stale' }] });

    fetchMock.mockClear();
    installFetch();
    await service.exec('todo.list', { status: 'open' });
    expect(execBodies()).toHaveLength(1);
  });

  it('reuses this user pending login and hides the job from another user', async () => {
    const first = await service.startLogin();
    const second = await service.startLogin();
    expect(second.jobId).toBe(first.jobId);
    expect(second.userCode).toBe('JCHB-KBXF');
    const posts = fetchMock.mock.calls.filter(
      (call) => String(call[0]).endsWith('/v1/login') && (call[1] as RequestInit).method === 'POST',
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String((posts[0][1] as RequestInit).body)).expectedProfile).toBe(
      'dingcorp:staff1',
    );

    fetchMock.mockClear();
    await expect(other.getLoginJob(first.jobId)).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_LOGIN_NOT_FOUND',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    try {
      await other.getLoginJob(first.jobId);
    } catch (error) {
      const blob = `${error instanceof Error ? error.message : ''} ${JSON.stringify(error)}`;
      expect(blob).not.toContain(VERIFICATION_URL);
      expect(blob).not.toContain(TOKEN);
    }
  });

  it('finalizes a matching login once and maps an identity mismatch', async () => {
    await service.startLogin();
    script.login = {
      ...script.login,
      identity: { corpId: 'dingcorp', corpName: '示例公司', userId: 'staff1', userName: '甲' },
      status: 'succeeded',
    };
    const view = await service.getLoginJob('job-owner-a');
    expect(view.status).toBe('succeeded');
    await service.getLoginJob('job-owner-a');
    expect(harness.audit).toHaveBeenCalledTimes(1);
    expect(harness.audit).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      'authorize',
      expect.objectContaining({ targetId: 'job-owner-a' }),
    );
    expect(harness.state.upserts).toBe(2);

    harness.redis.current = new FakeRedis();
    resetDingtalkPersonalLoginStoreForTest();
    resetDingtalkPersonalCacheForTest();
    harness.audit.mockClear();
    harness.state.upserts = 0;
    script.login = {
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      jobId: 'job-mismatch',
      status: 'pending',
      userCode: 'AAAA-BBBB',
      verificationUrl: VERIFICATION_URL,
    };
    await service.startLogin();
    script.login = {
      ...script.login,
      identity: { corpId: 'dingcorp', corpName: '示例公司', userId: 'other', userName: '别人' },
      status: 'succeeded',
    };
    const mismatch = await service.getLoginJob('job-mismatch');
    expect(mismatch).toMatchObject({
      errorCode: 'IDENTITY_MISMATCH',
      mismatchUserName: '别人',
      status: 'failed',
    });
    expect(harness.audit).not.toHaveBeenCalled();
    expect(harness.state.upserts).toBe(0);
  });

  it('revokes other active or expired rows that hold the same profile', async () => {
    harness.state.displaced = [
      { id: 'dpa_b', profile: 'dingcorp:staff1', userId: 'user-b' },
      { id: 'dpa_c', profile: 'dingcorp:staff1', userId: 'user-c' },
    ];
    await writeDingtalkPersonalCache('user-b', 'todo.list', { status: 'open' }, { n: 1 });
    await service.startLogin();
    script.login = {
      ...script.login,
      identity: { corpId: 'dingcorp', corpName: '示例公司', userId: 'staff1', userName: '甲' },
      status: 'succeeded',
    };
    await service.getLoginJob('job-owner-a');

    const revokes = harness.audit.mock.calls.filter((call) => call[2] === 'revoke');
    expect(revokes.map((call) => call[1])).toEqual(['user-b', 'user-c']);
    expect(revokes[0]?.[3]).toMatchObject({
      afterDiff: { corpId: 'dingcorp', staffId: 'staff1' },
      targetId: 'dpa_b',
    });
    expect(harness.invalidateWorkspaceTodos.mock.calls).toEqual([['user-b'], ['user-c']]);
    await expect(
      readDingtalkPersonalCache('user-b', 'todo.list', { status: 'open' }),
    ).resolves.toBeUndefined();
    expect(harness.audit).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      'authorize',
      expect.objectContaining({ targetId: 'job-owner-a' }),
    );
  });

  it('finalizes a completed login on cancel and does not drop the stored job', async () => {
    const { getStoredDingtalkPersonalLogin, isDingtalkPersonalLoginCancelled } =
      await import('./loginStore');
    await service.startLogin();
    script.login = {
      ...script.login,
      identity: { corpId: 'dingcorp', corpName: '示例公司', userId: 'staff1', userName: '甲' },
      status: 'succeeded',
    };
    await service.cancelLogin('job-owner-a');
    expect(harness.state.upserts).toBe(1);
    expect(harness.audit).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      'authorize',
      expect.objectContaining({ targetId: 'job-owner-a' }),
    );
    await expect(getStoredDingtalkPersonalLogin('job-owner-a')).resolves.toMatchObject({
      status: 'succeeded',
    });
    await expect(isDingtalkPersonalLoginCancelled('job-owner-a')).resolves.toBe(false);
    expect(
      fetchMock.mock.calls.filter(
        (call) =>
          String(call[0]).includes('/v1/login/') && (call[1] as RequestInit).method === 'DELETE',
      ),
    ).toHaveLength(0);
  });

  it('finalizes a login that completes in the cancel race', async () => {
    const { getStoredDingtalkPersonalLogin, isDingtalkPersonalLoginCancelled } =
      await import('./loginStore');
    script.login = {
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      jobId: 'job-race',
      status: 'pending',
      userCode: 'JCHB-KBXF',
      verificationUrl: VERIFICATION_URL,
    };
    script.cancel = {
      identity: { corpId: 'dingcorp', corpName: '示例公司', userId: 'staff1', userName: '甲' },
      ok: true,
      status: 'succeeded',
    };
    await service.startLogin();
    await service.cancelLogin('job-race');
    expect(script.cancelSawMarker).toBe(true);
    expect(harness.state.upserts).toBe(1);
    await expect(getStoredDingtalkPersonalLogin('job-race')).resolves.toMatchObject({
      status: 'succeeded',
    });
    await expect(isDingtalkPersonalLoginCancelled('job-race')).resolves.toBe(false);
  });

  it('cancels a pending login without finalizing it', async () => {
    const { getStoredDingtalkPersonalLogin, isDingtalkPersonalLoginCancelled } =
      await import('./loginStore');
    script.login = {
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      jobId: 'job-pending',
      status: 'pending',
      userCode: 'JCHB-KBXF',
      verificationUrl: VERIFICATION_URL,
    };
    script.cancel = { ok: true, status: 'cancelled' };
    await service.startLogin();
    await service.cancelLogin('job-pending');
    expect(script.cancelSawMarker).toBe(true);
    expect(harness.state.upserts).toBe(0);
    expect(harness.audit).not.toHaveBeenCalled();
    await expect(getStoredDingtalkPersonalLogin('job-pending')).resolves.toBeNull();
    await expect(isDingtalkPersonalLoginCancelled('job-pending')).resolves.toBe(true);
    expect(harness.stopWatch).toHaveBeenCalledWith('job-pending');
  });

  it('does not upsert when a cancel race returns a mismatched identity', async () => {
    const { getStoredDingtalkPersonalLogin, isDingtalkPersonalLoginCancelled } =
      await import('./loginStore');
    script.login = {
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      jobId: 'job-mismatch-cancel',
      status: 'pending',
      userCode: 'JCHB-KBXF',
      verificationUrl: VERIFICATION_URL,
    };
    script.cancel = {
      identity: { corpId: 'dingcorp', corpName: '示例公司', userId: 'other', userName: '别人' },
      ok: true,
      status: 'succeeded',
    };
    await service.startLogin();
    await service.cancelLogin('job-mismatch-cancel');
    expect(harness.state.upserts).toBe(0);
    expect(harness.audit).not.toHaveBeenCalled();
    await expect(getStoredDingtalkPersonalLogin('job-mismatch-cancel')).resolves.toMatchObject({
      errorCode: 'IDENTITY_MISMATCH',
      mismatchUserName: '别人',
      status: 'failed',
    });
    await expect(isDingtalkPersonalLoginCancelled('job-mismatch-cancel')).resolves.toBe(false);
  });

  it('does not revive a row revoked while checkStatus is in flight', async () => {
    harness.state.revokeAfterRead = true;
    await expect(service.checkStatus()).resolves.toMatchObject({ state: 'unauthorized' });
    expect(harness.state.row?.status).toBe('revoked');
    expect(harness.state.upsertOpts).toEqual({ onlyIfNotRevoked: true });
  });

  it('invalidates the personal read cache again after a write succeeds', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/v1/exec')) {
        const body = JSON.parse(String(init?.body));
        if (body.op === 'todo.complete') {
          await writeDingtalkPersonalCache(
            'user-a',
            'todo.list',
            { status: 'open' },
            { stale: true },
          );
        }
        return Response.json({ data: { ok: true }, ok: true });
      }
      return Response.json({ ok: true, removed: true });
    });

    await service.exec('todo.complete', { taskId: 'task-1' });
    await expect(
      readDingtalkPersonalCache('user-a', 'todo.list', { status: 'open' }),
    ).resolves.toBeUndefined();
  });

  it('revokes through the broker only when logout removed or the profile was absent', async () => {
    await service.revoke();
    const deleted = fetchMock.mock.calls.find(
      (call) =>
        String(call[0]).includes('/v1/profiles/') && (call[1] as RequestInit).method === 'DELETE',
    );
    expect(decodeURIComponent(String(deleted?.[0]))).toContain('dingcorp:staff1');
    expect(harness.state.row?.status).toBe('revoked');
    expect(harness.audit).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      'revoke',
      expect.objectContaining({ afterDiff: { corpId: 'dingcorp', staffId: 'staff1' } }),
    );

    harness.state.row = activeRow();
    harness.audit.mockClear();
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(Response.json({ absent: true, ok: true, removed: false }));
    await service.revoke();
    expect(harness.state.row?.status).toBe('revoked');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    harness.state.row = activeRow();
    harness.audit.mockClear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, removed: false }));
    await expect(service.revoke()).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_REVOKE_FAILED',
    });
    expect(harness.state.row?.status).toBe('active');
    expect(harness.audit).not.toHaveBeenCalled();

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: { code: 'LOGOUT_FAILED', message: `token=${TOKEN}` } },
        { status: 502 },
      ),
    );
    try {
      await service.revoke();
      throw new Error('expected revoke failure');
    } catch (error) {
      expect(error).toMatchObject({ code: 'DINGTALK_PERSONAL_REVOKE_FAILED' });
      expect(
        `${error instanceof Error ? error.message : ''} ${JSON.stringify(error)}`,
      ).not.toContain(TOKEN);
    }
    expect(harness.state.row?.status).toBe('active');
    expect(harness.audit).not.toHaveBeenCalled();

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error(`connect ${TOKEN}`));
    try {
      await service.revoke();
      throw new Error('expected unavailable');
    } catch (error) {
      expect(error).toMatchObject({ code: 'DINGTALK_PERSONAL_BROKER_UNAVAILABLE' });
      expect(
        `${error instanceof Error ? error.message : ''} ${JSON.stringify(error)}`,
      ).not.toContain(TOKEN);
    }
    expect(harness.state.row?.status).toBe('active');
    expect(harness.audit).not.toHaveBeenCalled();
  });

  it('marks the row revoked without logging out a profile another user holds', async () => {
    harness.state.otherActive = true;
    await service.revoke();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.state.row?.status).toBe('revoked');
    expect(harness.audit).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      'revoke',
      expect.objectContaining({ targetId: 'dpa_1' }),
    );
  });

  it('skips the revoke audit when the conditional update misses', async () => {
    harness.state.forceRevokeMiss = true;
    await service.revoke();
    expect(fetchMock).toHaveBeenCalled();
    expect(harness.state.row?.status).toBe('active');
    expect(harness.audit).not.toHaveBeenCalled();
  });

  it('does not call the broker when the caller has no row or is already revoked', async () => {
    harness.state.row = null;
    await service.revoke();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.requireSubject).not.toHaveBeenCalled();
    expect(harness.audit).not.toHaveBeenCalled();

    harness.state.row = { ...activeRow(), status: 'revoked' };
    await service.revoke();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.state.row.status).toBe('revoked');
  });

  it('refuses to revoke when the stored profile is not the server profile', async () => {
    harness.state.row = { ...activeRow(), profile: 'dingcorp:someone-else' };
    await expect(service.revoke()).rejects.toMatchObject({
      code: 'DINGTALK_PERSONAL_INTERNAL',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.state.row.status).toBe('active');
    expect(harness.audit).not.toHaveBeenCalled();
  });

  const profileDeletes = () =>
    fetchMock.mock.calls.filter(
      (call) =>
        String(call[0]).includes('/v1/profiles/') && (call[1] as RequestInit).method === 'DELETE',
    );

  const loginMeta = {
    createdAt: '2026-09-24T00:00:00.000Z',
    expectedProfile: 'dingcorp:staff1',
    expiresAt: '2026-09-24T00:15:00.000Z',
    jobId: 'job-lock',
    origin: 'web' as const,
    status: 'succeeded' as const,
    userCode: 'JCHB-KBXF',
    userId: 'user-b',
    verificationUrl: VERIFICATION_URL,
  };
  const succeededJob = {
    expiresAt: loginMeta.expiresAt,
    identity: { corpId: 'dingcorp', corpName: '示例公司', userId: 'staff1', userName: '乙' },
    jobId: 'job-lock',
    status: 'succeeded' as const,
    userCode: 'JCHB-KBXF',
    verificationUrl: VERIFICATION_URL,
  };

  it('does not delete a profile another user claims while revoke is waiting', async () => {
    let releaseClaim!: () => void;
    harness.state.claimGate = new Promise((resolve) => {
      releaseClaim = resolve;
    });
    const finalizing = finalizeDingtalkPersonalLogin({} as never, loginMeta, succeededJob);
    const revoking = (async () => {
      await vi.waitFor(() => {
        expect(harness.state.events).toEqual(['claim']);
      });
      return service.revoke();
    })();
    try {
      await vi.waitFor(() => {
        expect(dingtalkPersonalProfileLockDepthForTest(SUBJECT.profile)).toBeGreaterThanOrEqual(2);
      });
      expect(harness.state.events).toEqual(['claim']);
      expect(profileDeletes()).toHaveLength(0);
      releaseClaim();
      await expect(finalizing).resolves.toBe(true);
      await revoking;
    } finally {
      releaseClaim();
      await Promise.allSettled([finalizing, revoking]);
    }
    expect(harness.state.events).toEqual([
      'claim',
      'claim-done',
      'check',
      'check-done',
      'markRevoked',
    ]);
    expect(profileDeletes()).toHaveLength(0);
    expect(harness.state.row?.status).toBe('revoked');
  });

  it('does not claim a profile until revoke finishes logout and markRevoked', async () => {
    let releaseOwnership!: () => void;
    harness.state.ownershipGate = new Promise((resolve) => {
      releaseOwnership = resolve;
    });
    const revoking = service.revoke();
    const finalizing = (async () => {
      await vi.waitFor(() => {
        expect(harness.state.events).toEqual(['check']);
      });
      return finalizeDingtalkPersonalLogin({} as never, loginMeta, succeededJob);
    })();
    try {
      await vi.waitFor(() => {
        expect(dingtalkPersonalProfileLockDepthForTest(SUBJECT.profile)).toBeGreaterThanOrEqual(2);
      });
      expect(harness.state.events).toEqual(['check']);
      expect(profileDeletes()).toHaveLength(0);
      releaseOwnership();
      await revoking;
      await expect(finalizing).resolves.toBe(true);
    } finally {
      releaseOwnership();
      await Promise.allSettled([revoking, finalizing]);
    }
    expect(harness.state.events).toEqual([
      'check',
      'check-done',
      'delete',
      'markRevoked',
      'claim',
      'claim-done',
    ]);
    expect(profileDeletes()).toHaveLength(1);
    expect(harness.state.row?.status).toBe('active');
  });
});
