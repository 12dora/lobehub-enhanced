// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import type { LobeChatDatabase } from '@/database/type';
import { createCallerFactory } from '@/libs/trpc/lambda';

import { createAdminAuthorizationFixture } from '../../testing/adminAuthorizationFixture';
import { adminRouter } from '../admin';

const db: LobeChatDatabase = await getTestDB();
const createCaller = createCallerFactory(adminRouter);
const fixture = createAdminAuthorizationFixture({ namespace: 'im-connectors' });

const serviceMocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  test: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => db) }));

vi.mock('../../services/imConnectors/service', () => ({
  ImConnectorsAdminService: class {
    get = serviceMocks.get;
    list = serviceMocks.list;
    test = serviceMocks.test;
    upsert = serviceMocks.upsert;
  },
}));

const sampleView = {
  aiCardTemplateId: null,
  chatEnabled: true,
  clientId: null,
  clientSecretFingerprint: null,
  configured: false,
  enabled: false,
  hasClientSecret: false,
  idleNewTopicEnabled: true,
  idleNewTopicHours: 24,
  platform: 'dingtalk' as const,
  pushEnabled: true,
  robotCode: null,
  selectCardTemplateId: null,
  stats: { linkedUsers: 0, messages7d: 0, pushes7d: 0 },
  status: {
    connectedAt: null,
    lastError: null,
    lastErrorAt: null,
    lastEventAt: null,
    state: 'unknown' as const,
  },
  updatedAt: null,
};

beforeAll(async () => {
  vi.stubEnv('ENABLE_PLATFORM_ADMIN', '1');
  await fixture.setup(db);
});

afterAll(async () => {
  await fixture.cleanup(db);
  vi.unstubAllEnvs();
});

beforeEach(() => {
  serviceMocks.get.mockReset().mockResolvedValue(sampleView);
  serviceMocks.list.mockReset().mockResolvedValue({ items: [sampleView] });
  serviceMocks.test.mockReset().mockResolvedValue({
    errorCode: null,
    errorMessage: null,
    latencyMs: 8,
    ok: true,
    robotName: null,
  });
  serviceMocks.upsert.mockReset().mockResolvedValue({ ...sampleView, configured: true });
});

const callerFor = async (principal: 'auditor' | 'normal' | 'superAdmin') => {
  const contexts = await fixture.createContexts(db);
  return createCaller(contexts[principal] as never).imConnectors;
};

describe('admin.imConnectors permission gating', () => {
  it('denies list/get/upsert/test for a user without system permissions', async () => {
    const denied = await callerFor('normal');

    await expect(denied.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(denied.get({ platform: 'dingtalk' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(
      denied.upsert({
        aiCardTemplateId: null,
        chatEnabled: true,
        clientId: 'app',
        clientSecret: { action: 'replace', value: 'secret' },
        enabled: true,
        idleNewTopicEnabled: true,
        idleNewTopicHours: 24,
        platform: 'dingtalk',
        pushEnabled: true,
        robotCode: 'robot',
        selectCardTemplateId: null,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(denied.test({ platform: 'dingtalk' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    expect(serviceMocks.list).not.toHaveBeenCalled();
    expect(serviceMocks.upsert).not.toHaveBeenCalled();
    expect(serviceMocks.test).not.toHaveBeenCalled();
  });

  it('allows SYSTEM_READ list/get but not SYSTEM_OPERATE upsert/test', async () => {
    const reader = await callerFor('auditor');

    await expect(reader.list()).resolves.toEqual({ items: [sampleView] });
    await expect(reader.get({ platform: 'dingtalk' })).resolves.toEqual(sampleView);
    await expect(
      reader.upsert({
        aiCardTemplateId: null,
        chatEnabled: true,
        clientId: 'app',
        clientSecret: { action: 'replace', value: 'secret' },
        enabled: true,
        idleNewTopicEnabled: true,
        idleNewTopicHours: 24,
        platform: 'dingtalk',
        pushEnabled: true,
        robotCode: 'robot',
        selectCardTemplateId: null,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    await expect(reader.test({ platform: 'dingtalk' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'PLATFORM_PERMISSION_DENIED',
    });
    expect(serviceMocks.upsert).not.toHaveBeenCalled();
    expect(serviceMocks.test).not.toHaveBeenCalled();
  });

  it('allows SYSTEM_OPERATE upsert and test for a super admin', async () => {
    const operator = await callerFor('superAdmin');

    await expect(operator.list()).resolves.toEqual({ items: [sampleView] });
    await expect(
      operator.upsert({
        aiCardTemplateId: null,
        chatEnabled: true,
        clientId: 'app',
        clientSecret: { action: 'replace', value: 'secret' },
        enabled: true,
        idleNewTopicEnabled: true,
        idleNewTopicHours: 24,
        platform: 'dingtalk',
        pushEnabled: true,
        reason: 'provision dingtalk',
        robotCode: 'robot',
        selectCardTemplateId: null,
      }),
    ).resolves.toMatchObject({ configured: true });
    await expect(operator.test({ platform: 'dingtalk' })).resolves.toMatchObject({ ok: true });
    expect(serviceMocks.upsert).toHaveBeenCalled();
    expect(serviceMocks.test).toHaveBeenCalled();
  });
});
