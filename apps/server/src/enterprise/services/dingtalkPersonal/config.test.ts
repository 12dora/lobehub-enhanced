// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ModuleSettingsModule from '@/server/enterprise/services/moduleSettings';

const envBag = vi.hoisted(() => ({
  DINGTALK_PERSONAL_BROKER_TOKEN: 't'.repeat(32) as string | undefined,
  DINGTALK_PERSONAL_BROKER_URL: 'http://aihub-dws:8080' as string | undefined,
}));
const findByPlatform = vi.hoisted(() => vi.fn());
const mockIsModuleEnabled = vi.hoisted(() => vi.fn(async (_id: string) => true));
const mockModuleEpoch = vi.hoisted(() => vi.fn(async () => 'epoch-1' as string | undefined));

vi.mock('@/envs/dingtalkPersonal', () => ({
  dingtalkPersonalEnv: envBag,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => ({}),
}));

vi.mock('@/database/models/systemBotProvider', () => ({
  SystemBotProviderModel: { findByPlatform: (...args: unknown[]) => findByPlatform(...args) },
}));

vi.mock('@/server/enterprise/services/moduleSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof ModuleSettingsModule>();
  return {
    ...actual,
    currentModuleSettingsInvalidationEpoch: () => mockModuleEpoch(),
    isModuleEnabled: (id: string) => mockIsModuleEnabled(id),
  };
});

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => undefined },
}));

const {
  DINGTALK_PERSONAL_OP_FEATURE,
  DINGTALK_PERSONAL_WRITE_OPS,
  getDingtalkPersonalConfig,
  resetDingtalkPersonalConfigForTest,
} = await import('./config');

afterEach(() => {
  vi.useRealTimers();
});

const switches = (patch: Record<string, unknown> = {}) => ({
  settings: {
    personalChatEnabled: true,
    personalDataEnabled: true,
    personalDocsEnabled: true,
    personalReportEnabled: true,
    personalSheetsEnabled: true,
    personalTodoEnabled: true,
    personalWriteEnabled: true,
    ...patch,
  },
});

describe('dingtalk personal config', () => {
  beforeEach(() => {
    resetDingtalkPersonalConfigForTest();
    mockIsModuleEnabled.mockImplementation(async () => true);
    mockModuleEpoch.mockResolvedValue('epoch-1');
    findByPlatform.mockReset();
    envBag.DINGTALK_PERSONAL_BROKER_URL = 'http://aihub-dws:8080';
    envBag.DINGTALK_PERSONAL_BROKER_TOKEN = 't'.repeat(32);
    findByPlatform.mockResolvedValue(switches());
  });

  it('turns each feature on only when the master switch, that switch, and the broker are set', async () => {
    const config = await getDingtalkPersonalConfig();
    expect(config).toEqual({
      brokerConfigured: true,
      enabled: true,
      features: { chat: true, docs: true, report: true, sheets: true, todo: true, write: true },
    });
    await getDingtalkPersonalConfig();
    expect(findByPlatform).toHaveBeenCalledTimes(1);

    mockModuleEpoch.mockResolvedValue('epoch-2');
    await getDingtalkPersonalConfig();
    expect(findByPlatform).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the dingtalkPersonal module is off', async () => {
    mockIsModuleEnabled.mockImplementation(async (id: string) => id !== 'dingtalkPersonal');
    const config = await getDingtalkPersonalConfig();
    expect(config.brokerConfigured).toBe(true);
    expect(config.enabled).toBe(false);
    expect(config.features).toEqual({
      chat: false,
      docs: false,
      report: false,
      sheets: false,
      todo: false,
      write: false,
    });
  });

  it('turns docs and sheets off when the dingtalkDocs module is off', async () => {
    mockIsModuleEnabled.mockImplementation(async (id: string) => id !== 'dingtalkDocs');
    const config = await getDingtalkPersonalConfig();
    expect(config.enabled).toBe(true);
    expect(config.features).toEqual({
      chat: true,
      docs: false,
      report: true,
      sheets: false,
      todo: true,
      write: true,
    });
  });

  it('accepts only boolean true and ignores the sub-switches when the master is off', async () => {
    findByPlatform.mockResolvedValue(
      switches({
        personalChatEnabled: 'true',
        personalDataEnabled: 1,
        personalTodoEnabled: true,
      }),
    );
    const config = await getDingtalkPersonalConfig();
    expect(config.enabled).toBe(false);
    expect(config.features).toEqual({
      chat: false,
      docs: false,
      report: false,
      sheets: false,
      todo: false,
      write: false,
    });
  });

  it('stays disabled when the broker env is missing', async () => {
    envBag.DINGTALK_PERSONAL_BROKER_TOKEN = undefined;
    const config = await getDingtalkPersonalConfig();
    expect(config.brokerConfigured).toBe(false);
    expect(config.enabled).toBe(false);
    expect(config.features.todo).toBe(false);
  });

  it('fails closed when the connector row cannot be read', async () => {
    findByPlatform.mockRejectedValue(new Error('db down'));
    const config = await getDingtalkPersonalConfig();
    expect(config.enabled).toBe(false);
    expect(config.brokerConfigured).toBe(true);
    expect(config.features.chat).toBe(false);
  });

  it('keeps docs and sheets off unless their own switches are boolean true', async () => {
    findByPlatform.mockResolvedValue(
      switches({ personalDocsEnabled: 'true', personalSheetsEnabled: 1 }),
    );
    const config = await getDingtalkPersonalConfig();
    expect(config.enabled).toBe(true);
    expect(config.features.docs).toBe(false);
    expect(config.features.sheets).toBe(false);
    expect(config.features.chat).toBe(true);
  });

  it('maps the docs and sheets sidecar ops and marks the five writes', () => {
    expect(DINGTALK_PERSONAL_OP_FEATURE['doc.search']).toBe('docs');
    expect(DINGTALK_PERSONAL_OP_FEATURE['doc.info']).toBe('docs');
    expect(DINGTALK_PERSONAL_OP_FEATURE['drive.download']).toBe('docs');
    expect(DINGTALK_PERSONAL_OP_FEATURE['wiki.nodes']).toBe('docs');
    expect(DINGTALK_PERSONAL_OP_FEATURE['sheet.read']).toBe('sheets');
    expect(DINGTALK_PERSONAL_OP_FEATURE['aitable.records.create']).toBe('sheets');
    expect(DINGTALK_PERSONAL_WRITE_OPS).toEqual(
      expect.arrayContaining([
        'doc.append',
        'doc.create',
        'sheet.append',
        'aitable.records.create',
        'aitable.records.update',
      ]),
    );
    expect(DINGTALK_PERSONAL_WRITE_OPS).not.toContain('doc.read');
    expect(DINGTALK_PERSONAL_WRITE_OPS).not.toContain('doc.info');
    expect(DINGTALK_PERSONAL_WRITE_OPS).not.toContain('drive.download');
  });

  it('refetches after the 30s cache window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    await getDingtalkPersonalConfig();
    vi.setSystemTime(new Date('2026-09-24T00:00:29.000Z'));
    await getDingtalkPersonalConfig();
    expect(findByPlatform).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-24T00:00:31.000Z'));
    await getDingtalkPersonalConfig();
    expect(findByPlatform).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
