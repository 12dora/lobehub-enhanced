import debug from 'debug';

import { getMessengerDingTalkConfig } from '@/config/messenger';

import { DINGTALK_INSTALLATION_KEY } from '../platforms/dingtalk/const';
import type { InstallationCredentials, MessengerInstallationStore } from './types';

const log = debug('lobe-server:messenger:install-store:dingtalk');

const buildCreds = async (): Promise<InstallationCredentials | null> => {
  const config = await getMessengerDingTalkConfig();
  if (!config) return null;
  return {
    accountId: undefined,
    applicationId: config.clientId,
    botToken: config.clientSecret,
    installationKey: DINGTALK_INSTALLATION_KEY,
    metadata: {
      chatEnabled: config.chatEnabled,
      clientId: config.clientId,
      pushEnabled: config.pushEnabled,
      robotCode: config.robotCode,
    },
    platform: 'dingtalk',
    tenantId: '',
  };
};

export class DingTalkInstallationStore implements MessengerInstallationStore {
  async resolveByPayload(): Promise<InstallationCredentials | null> {
    const creds = await buildCreds();
    if (!creds) log('resolveByPayload: dingtalk credentials not configured in DB');
    return creds;
  }

  async resolveByKey(installationKey: string): Promise<InstallationCredentials | null> {
    if (installationKey !== DINGTALK_INSTALLATION_KEY) return null;
    return buildCreds();
  }
}

export { DINGTALK_INSTALLATION_KEY };
