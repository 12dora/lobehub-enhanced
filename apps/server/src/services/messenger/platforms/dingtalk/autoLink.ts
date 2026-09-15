import debug from 'debug';
import { sql } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { UserModel } from '@/database/models/user';
import type { MessengerAccountLinkItem } from '@/database/schemas';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type { MessengerPlatformBinder } from '../../types';
import {
  buildDingTalkIdentityEmail,
  DINGTALK_UNKNOWN_USER_REPLY,
  resolveDingTalkIdentityEmailDomain,
} from './const';

const log = debug('lobe-server:messenger:dingtalk:auto-link');

const replyUnknownUser = async (params: TryAutoLinkDingTalkParams): Promise<void> => {
  try {
    await params.binder.sendDmText(params.chatId, DINGTALK_UNKNOWN_USER_REPLY);
  } catch (error) {
    console.error('tryAutoLinkDingTalk: failed to send unknown-user reply', error);
  }
};

const findUserByDingTalkEmail = async (db: LobeChatDatabase, staffId: string) => {
  const email = buildDingTalkIdentityEmail(staffId);
  const exact = await UserModel.findByEmail(db, email);
  if (exact) return exact;

  const normalized = email.toLowerCase();
  return db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${normalized}`,
  });
};

const resolveInboxAgentId = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<string | undefined> => {
  const inbox = await new AgentModel(db, userId).getBuiltinAgent('inbox');
  return inbox?.id;
};

export interface TryAutoLinkDingTalkParams {
  binder: MessengerPlatformBinder;
  chatId: string;
  senderNick?: string;
  senderStaffId: string;
  serverDB: LobeChatDatabase;
}

/**
 * Map `senderStaffId` → AIHub user via the identity-email convention and upsert
 * `messenger_account_links`. Returns the link on success. Unknown staffId
 * replies the fixed login sentence and returns null — DingTalk never uses
 * the verify-im link-token flow.
 */
export const tryAutoLinkDingTalk = async (
  params: TryAutoLinkDingTalkParams,
): Promise<MessengerAccountLinkItem | null> => {
  const staffId = params.senderStaffId.trim();
  if (!staffId) {
    await replyUnknownUser(params);
    return null;
  }

  const user = await findUserByDingTalkEmail(params.serverDB, staffId);
  if (!user) {
    log(
      'tryAutoLinkDingTalk: no user for staffId=%s domain=%s',
      staffId,
      resolveDingTalkIdentityEmailDomain(),
    );
    await replyUnknownUser(params);
    return null;
  }

  const activeAgentId = await resolveInboxAgentId(params.serverDB, user.id);
  const model = new MessengerAccountLinkModel(params.serverDB, user.id);
  const link = await model.upsertForPlatform({
    activeAgentId: activeAgentId ?? null,
    platform: 'dingtalk',
    platformUserId: staffId,
    platformUsername: params.senderNick,
    tenantId: '',
    workspaceId: null,
  });
  log('tryAutoLinkDingTalk: linked staffId=%s → user=%s agent=%s', staffId, user.id, activeAgentId);
  return link;
};
