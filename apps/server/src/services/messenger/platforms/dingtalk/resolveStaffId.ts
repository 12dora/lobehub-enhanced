import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

import { resolveDingTalkIdentityEmailDomain } from './const';

/**
 * DingTalk staffId from the identity-email convention
 * (`<staffId>@DINGTALK_IDENTITY_EMAIL_DOMAIN`). Returns null when the
 * mailbox is missing or the domain does not match.
 */
export const staffIdFromDingTalkIdentityEmail = (
  email: string | null | undefined,
): string | null => {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = email.slice(at + 1);
  const expected = resolveDingTalkIdentityEmailDomain();
  if (domain.toLowerCase() !== expected.toLowerCase()) return null;
  const local = email.slice(0, at).trim();
  return local.length > 0 ? local : null;
};

/**
 * Resolve the DingTalk corp userid for an AIHub user: a
 * `messenger_account_links` row for `(userId, dingtalk)` wins, otherwise the
 * identity-email local-part. Used by push and by `availablePlatforms.binding`.
 */
export const resolveDingTalkStaffId = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<string | null> => {
  const link = await new MessengerAccountLinkModel(db, userId).findByPlatform('dingtalk', '');
  if (link?.platformUserId) return link.platformUserId;

  const user = await UserModel.findById(db, userId);
  return staffIdFromDingTalkIdentityEmail(user?.email ?? null);
};
