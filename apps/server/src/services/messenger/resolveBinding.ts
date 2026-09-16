import type { MessengerPlatformBinding } from '@lobechat/types';

import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

import { staffIdFromDingTalkIdentityEmail } from './platforms/dingtalk/resolveStaffId';

export type { MessengerPlatformBinding };

/**
 * Per-user mapping status for each enabled messenger platform.
 *
 * `linked` is true when a `messenger_account_links` row exists for
 * `(userId, platform)`, or (DingTalk only) the user's email matches the
 * identity-email convention used by DingTalk push.
 */
export const resolveMessengerPlatformBindings = async (
  db: LobeChatDatabase,
  userId: string | null | undefined,
  platforms: string[],
): Promise<Record<string, MessengerPlatformBinding>> => {
  const result: Record<string, MessengerPlatformBinding> = {};
  for (const platform of platforms) {
    result[platform] = { linked: false, platformUsername: null };
  }
  if (!userId) return result;

  const links = await new MessengerAccountLinkModel(db, userId).list();
  for (const link of links) {
    if (!(link.platform in result) || result[link.platform]?.linked) continue;
    result[link.platform] = {
      linked: true,
      platformUsername: link.platformUsername ?? null,
    };
  }

  if (platforms.includes('dingtalk') && !result.dingtalk?.linked) {
    const user = await UserModel.findById(db, userId);
    if (staffIdFromDingTalkIdentityEmail(user?.email ?? null)) {
      result.dingtalk = { linked: true, platformUsername: null };
    }
  }

  return result;
};
