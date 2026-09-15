import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { MessengerAccountLinkItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { isEffectivelyBanned } from '@/database/utils/userBan';

import type { MessengerPlatformBinder } from '../../types';
import { resolveDingTalkBrandingDisplayName } from './branding';
import { formatDingTalkUnknownUserReply } from './const';
import { ensureDingTalkUser } from './provision';

const log = debug('lobe-server:messenger:dingtalk:auto-link');

const replyUnknownUser = async (params: TryAutoLinkDingTalkParams): Promise<void> => {
  try {
    const displayName = await resolveDingTalkBrandingDisplayName();
    await params.binder.sendDmText(params.chatId, formatDingTalkUnknownUserReply(displayName));
  } catch (error) {
    console.error('tryAutoLinkDingTalk: failed to send unknown-user reply', error);
  }
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
 * `messenger_account_links`. Missing users are JIT-provisioned. Returns the
 * link on success. Provisioning failure replies the fixed login sentence and
 * returns null — DingTalk never uses the verify-im link-token flow.
 */
export const tryAutoLinkDingTalk = async (
  params: TryAutoLinkDingTalkParams,
): Promise<MessengerAccountLinkItem | null> => {
  const staffId = params.senderStaffId.trim();
  if (!staffId) {
    await replyUnknownUser(params);
    return null;
  }

  const user = await ensureDingTalkUser(params.serverDB, {
    senderNick: params.senderNick,
    staffId,
  });
  if (!user) {
    log('tryAutoLinkDingTalk: provision failed staffId=%s', staffId);
    await replyUnknownUser(params);
    return null;
  }

  // Same predicate as DingTalk 免登 / better-auth admin (`banned` + unexpired
  // `banExpires`). Reuse the unknown-user sentence so a ban is not leaked.
  if (isEffectivelyBanned(user)) {
    log('tryAutoLinkDingTalk: banned staffId=%s', staffId);
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
