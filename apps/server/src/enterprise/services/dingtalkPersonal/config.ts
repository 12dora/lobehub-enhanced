import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { SystemBotProviderModel } from '@/database/models/systemBotProvider';
import { dingtalkPersonalEnv } from '@/envs/dingtalkPersonal';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

const log = debug('lobe-server:dingtalk-personal:config');

export const DINGTALK_PERSONAL_CONFIG_CACHE_MS = 30_000;

export type DingtalkPersonalFeature = 'todo' | 'chat' | 'report' | 'write';

export interface DingtalkPersonalConfig {
  /** URL and token env vars are both present. */
  brokerConfigured: boolean;
  /** personalDataEnabled && brokerConfigured. Fail closed. */
  enabled: boolean;
  features: Record<DingtalkPersonalFeature, boolean>;
}

export type DingtalkPersonalOp =
  | 'todo.list'
  | 'todo.get'
  | 'todo.update'
  | 'todo.complete'
  | 'chat.searchGroups'
  | 'chat.myGroups'
  | 'chat.messages'
  | 'chat.searchMessages'
  | 'chat.downloadFile'
  | 'report.inbox'
  | 'report.outbox'
  | 'report.get'
  | 'report.templates'
  | 'report.template'
  | 'report.submit'
  | 'contact.self';

export const DINGTALK_PERSONAL_OP_FEATURE = {
  'chat.downloadFile': 'chat',
  'chat.messages': 'chat',
  'chat.myGroups': 'chat',
  'chat.searchGroups': 'chat',
  'chat.searchMessages': 'chat',
  'contact.self': null,
  'report.get': 'report',
  'report.inbox': 'report',
  'report.outbox': 'report',
  'report.submit': 'report',
  'report.template': 'report',
  'report.templates': 'report',
  'todo.complete': 'todo',
  'todo.get': 'todo',
  'todo.list': 'todo',
  'todo.update': 'todo',
} as const satisfies Record<DingtalkPersonalOp, DingtalkPersonalFeature | null>;

export const DINGTALK_PERSONAL_WRITE_OPS = [
  'todo.update',
  'todo.complete',
  'report.submit',
] as const satisfies readonly DingtalkPersonalOp[];

const FEATURES_OFF: Record<DingtalkPersonalFeature, boolean> = {
  chat: false,
  report: false,
  todo: false,
  write: false,
};

interface ConfigSnapshot extends DingtalkPersonalConfig {
  fetchedAt: number;
}

let cache: ConfigSnapshot | null = null;

export const resetDingtalkPersonalConfigForTest = (): void => {
  cache = null;
};

export const invalidateDingtalkPersonalConfig = (): void => {
  cache = null;
};

const readBrokerConfigured = (): boolean =>
  Boolean(
    dingtalkPersonalEnv.DINGTALK_PERSONAL_BROKER_URL &&
    dingtalkPersonalEnv.DINGTALK_PERSONAL_BROKER_TOKEN,
  );

/**
 * B2b adds these fields to the connector zod schema in parallel.
 * Only an actual boolean `true` turns a switch on; anything else stays off.
 */
const readSwitches = (raw: Record<string, unknown> | undefined) => ({
  chat: raw?.personalChatEnabled === true,
  data: raw?.personalDataEnabled === true,
  report: raw?.personalReportEnabled === true,
  todo: raw?.personalTodoEnabled === true,
  write: raw?.personalWriteEnabled === true,
});

const loadSnapshot = async (): Promise<ConfigSnapshot> => {
  const now = Date.now();
  if (cache && cache.fetchedAt + DINGTALK_PERSONAL_CONFIG_CACHE_MS > now) return cache;

  const configured = readBrokerConfigured();
  const closed: ConfigSnapshot = {
    brokerConfigured: configured,
    enabled: false,
    features: { ...FEATURES_OFF },
    fetchedAt: now,
  };

  try {
    const db = await getServerDB();
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
    const row = await SystemBotProviderModel.findByPlatform(db, 'dingtalk', gateKeeper);
    const switches = readSwitches(isRecord(row?.settings) ? row.settings : undefined);
    const enabled = configured && switches.data;
    cache = {
      brokerConfigured: configured,
      enabled,
      features: {
        chat: enabled && switches.chat,
        report: enabled && switches.report,
        todo: enabled && switches.todo,
        write: enabled && switches.write,
      },
      fetchedAt: now,
    };
    return cache;
  } catch (error) {
    log('load config failed: %s', error instanceof Error ? error.name : 'UnknownError');
    cache = closed;
    return closed;
  }
};

export const getDingtalkPersonalConfig = async (): Promise<DingtalkPersonalConfig> => {
  const snapshot = await loadSnapshot();
  return {
    brokerConfigured: snapshot.brokerConfigured,
    enabled: snapshot.enabled,
    features: { ...snapshot.features },
  };
};
