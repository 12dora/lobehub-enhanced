import type { MessengerPlatformBinding } from '@lobechat/types';

import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';

import { resolveDingTalkStaffId } from './platforms/dingtalk/resolveStaffId';

export type { MessengerPlatformBinding };

/**
 * Per-user mapping status for each enabled messenger platform.
 *
 * `linked` is true when a `messenger_account_links` row exists for
 * `(userId, platform)`. DingTalk uses the same lookup as push
 * (`resolveDingTalkStaffId`: `findByPlatform('dingtalk', '')`, then the
 * identity-email convention) so `binding.linked` cannot drift from a
 * `user_not_mapped` skip.
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
      platformUsername: link.platformUsername ?? link.platformUserId ?? null,
    };
  }

  if (platforms.includes('dingtalk')) {
    const staffId = await resolveDingTalkStaffId(db, userId);
    result.dingtalk = staffId
      ? {
          linked: true,
          platformUsername: result.dingtalk?.platformUsername ?? staffId,
        }
      : { linked: false, platformUsername: null };
  }

  return result;
};
