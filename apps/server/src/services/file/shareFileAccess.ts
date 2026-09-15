import type { LobeChatDatabase } from '@lobechat/database';
import { and, eq } from 'drizzle-orm';

import { files, messages, messagesFiles, topicShares } from '@/database/schemas';

/**
 * Whether GET /f/:fileId?share=:shareId may proceed without a session.
 *
 * One join: `topic_shares` ⋈ `messages` ⋈ `messages_files` ⋈ `files`.
 * The share must be a live `link` row, the file must be attached to a
 * message in that share's topic, and both the attachment row and the file
 * row must belong to the share owner. Binding `files.userId` closes the
 * "attacker attaches a victim fileId to their own link-shared topic" hole
 * (review-c1 finding 1); `messages_files.userId = topic_shares.userId` is
 * the contract owner constraint.
 */
export const resolveShareFileAccess = async (params: {
  db: LobeChatDatabase;
  fileId: string;
  shareId: string;
}): Promise<boolean> => {
  const { db, fileId, shareId } = params;

  const rows = await db
    .select({ id: topicShares.id })
    .from(topicShares)
    .innerJoin(messages, eq(messages.topicId, topicShares.topicId))
    .innerJoin(messagesFiles, eq(messagesFiles.messageId, messages.id))
    .innerJoin(files, eq(files.id, messagesFiles.fileId))
    .where(
      and(
        eq(topicShares.id, shareId),
        eq(topicShares.visibility, 'link'),
        eq(messagesFiles.fileId, fileId),
        eq(messagesFiles.userId, topicShares.userId),
        eq(files.userId, topicShares.userId),
      ),
    )
    .limit(1);

  return rows.length > 0;
};
