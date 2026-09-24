import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import { DingtalkWorkspaceError } from '@/server/enterprise/services/dingtalkWorkspace/errors';
import { requireVerifiedDingtalkIdentity } from '@/server/enterprise/services/dingtalkWorkspace/identity';
import { getDingTalkSsoConfig } from '@/server/services/messenger/platforms/dingtalk/sso';

import { DingtalkPersonalError } from './errors';

const log = debug('lobe-server:dingtalk-personal:identity');

const IDENTITY_CODES = new Set<string>([
  'DINGTALK_IDENTITY_INACTIVE',
  'DINGTALK_IDENTITY_UNBOUND',
  'DINGTALK_IDENTITY_UNVERIFIED',
]);

export type DingtalkPersonalSubjectFailure =
  | 'DINGTALK_IDENTITY_INACTIVE'
  | 'DINGTALK_IDENTITY_UNBOUND'
  | 'DINGTALK_IDENTITY_UNVERIFIED'
  | 'DINGTALK_PERSONAL_CORP_ID_MISSING'
  | 'DINGTALK_PERSONAL_INTERNAL';

export type DingtalkPersonalSubject =
  | {
      corpId: string;
      ok: true;
      profile: string;
      staffId: string;
      userName: string;
    }
  | { code: DingtalkPersonalSubjectFailure; ok: false };

export const buildDingtalkPersonalProfile = (corpId: string, staffId: string): string =>
  `${corpId}:${staffId}`;

export const splitDingtalkPersonalProfile = (
  profile: string,
): { corpId: string; staffId: string } | null => {
  const index = profile.indexOf(':');
  if (index <= 0 || index >= profile.length - 1) return null;
  const corpId = profile.slice(0, index);
  const staffId = profile.slice(index + 1);
  if (!corpId || !staffId || staffId.includes(':')) return null;
  return { corpId, staffId };
};

/**
 * Expected broker profile is always `<corpId>:<staffId>` from the verified
 * DingTalk identity and the connector corp id. Tool arguments are ignored.
 */
export const resolveDingtalkPersonalSubject = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<DingtalkPersonalSubject> => {
  let staffId: string;
  let userName: string;
  try {
    const identity = await requireVerifiedDingtalkIdentity(db, userId);
    staffId = identity.staffId.trim();
    userName = identity.name.trim();
  } catch (error) {
    if (error instanceof DingtalkWorkspaceError && IDENTITY_CODES.has(error.code)) {
      return { code: error.code as DingtalkPersonalSubjectFailure, ok: false };
    }
    log('resolve identity failed: %s', error instanceof Error ? error.name : 'UnknownError');
    return { code: 'DINGTALK_PERSONAL_INTERNAL', ok: false };
  }

  if (!staffId || staffId.includes(':')) {
    return { code: 'DINGTALK_PERSONAL_INTERNAL', ok: false };
  }

  let corpId: string;
  try {
    const sso = await getDingTalkSsoConfig();
    corpId = sso.enabled ? (sso.corpId?.trim() ?? '') : '';
  } catch (error) {
    log('load corp id failed: %s', error instanceof Error ? error.name : 'UnknownError');
    return { code: 'DINGTALK_PERSONAL_INTERNAL', ok: false };
  }

  if (!corpId) return { code: 'DINGTALK_PERSONAL_CORP_ID_MISSING', ok: false };
  if (corpId.includes(':')) return { code: 'DINGTALK_PERSONAL_INTERNAL', ok: false };

  return {
    corpId,
    ok: true,
    profile: buildDingtalkPersonalProfile(corpId, staffId),
    staffId,
    userName,
  };
};

export const requireDingtalkPersonalSubject = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<Extract<DingtalkPersonalSubject, { ok: true }>> => {
  const subject = await resolveDingtalkPersonalSubject(db, userId);
  if (!subject.ok) throw new DingtalkPersonalError(subject.code);
  return subject;
};
