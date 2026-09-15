// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { files, messages, messagesFiles, topics, topicShares, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { resolveShareFileAccess } from './shareFileAccess';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'sfa-owner';
const attackerId = 'sfa-attacker';
const userIds = [ownerId, attackerId];

const fileOf = (id: string, overrides: Partial<typeof files.$inferInsert> = {}) => ({
  fileType: 'image/png',
  id,
  name: `${id}.png`,
  size: 128,
  url: `files/${id}.png`,
  userId: ownerId,
  ...overrides,
});

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, userIds));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values(userIds.map((id) => ({ id })));
});

afterEach(cleanup);

describe('resolveShareFileAccess (real DB)', () => {
  it('allows a file attached by the owner to a topic with visibility=link', async () => {
    await serverDB.insert(topics).values({ id: 'sfa-topic-link', title: 'Link', userId: ownerId });
    await serverDB.insert(messages).values({
      content: 'see this',
      id: 'sfa-msg-link',
      role: 'user',
      topicId: 'sfa-topic-link',
      userId: ownerId,
    });
    await serverDB.insert(files).values(fileOf('sfa-file-link'));
    await serverDB.insert(messagesFiles).values({
      fileId: 'sfa-file-link',
      messageId: 'sfa-msg-link',
      userId: ownerId,
    });
    await serverDB.insert(topicShares).values({
      id: 'sfa-share-link',
      topicId: 'sfa-topic-link',
      userId: ownerId,
      visibility: 'link',
    });

    await expect(
      resolveShareFileAccess({
        db: serverDB,
        fileId: 'sfa-file-link',
        shareId: 'sfa-share-link',
      }),
    ).resolves.toBe(true);
  });

  it('denies when the owner share is private rather than link', async () => {
    await serverDB
      .insert(topics)
      .values({ id: 'sfa-topic-private', title: 'Private', userId: ownerId });
    await serverDB.insert(messages).values({
      content: 'private',
      id: 'sfa-msg-private',
      role: 'user',
      topicId: 'sfa-topic-private',
      userId: ownerId,
    });
    await serverDB.insert(files).values(fileOf('sfa-file-private'));
    await serverDB.insert(messagesFiles).values({
      fileId: 'sfa-file-private',
      messageId: 'sfa-msg-private',
      userId: ownerId,
    });
    await serverDB.insert(topicShares).values({
      id: 'sfa-share-private',
      topicId: 'sfa-topic-private',
      userId: ownerId,
      visibility: 'private',
    });

    await expect(
      resolveShareFileAccess({
        db: serverDB,
        fileId: 'sfa-file-private',
        shareId: 'sfa-share-private',
      }),
    ).resolves.toBe(false);
  });

  it('denies an attacker who attaches a victim fileId to their own link-shared topic', async () => {
    await serverDB.insert(files).values(fileOf('sfa-file-victim'));
    await serverDB
      .insert(topics)
      .values({ id: 'sfa-topic-attack', title: 'Attack', userId: attackerId });
    await serverDB.insert(messages).values({
      content: 'stolen',
      id: 'sfa-msg-attack',
      role: 'user',
      topicId: 'sfa-topic-attack',
      userId: attackerId,
    });
    await serverDB.insert(messagesFiles).values({
      fileId: 'sfa-file-victim',
      messageId: 'sfa-msg-attack',
      userId: attackerId,
    });
    await serverDB.insert(topicShares).values({
      id: 'sfa-share-attack',
      topicId: 'sfa-topic-attack',
      userId: attackerId,
      visibility: 'link',
    });

    await expect(
      resolveShareFileAccess({
        db: serverDB,
        fileId: 'sfa-file-victim',
        shareId: 'sfa-share-attack',
      }),
    ).resolves.toBe(false);
  });

  it('denies when the file is attached to a different topic than the share', async () => {
    await serverDB.insert(topics).values([
      { id: 'sfa-topic-a', title: 'A', userId: ownerId },
      { id: 'sfa-topic-b', title: 'B', userId: ownerId },
    ]);
    await serverDB.insert(messages).values({
      content: 'on A',
      id: 'sfa-msg-a',
      role: 'user',
      topicId: 'sfa-topic-a',
      userId: ownerId,
    });
    await serverDB.insert(files).values(fileOf('sfa-file-wrong-topic'));
    await serverDB.insert(messagesFiles).values({
      fileId: 'sfa-file-wrong-topic',
      messageId: 'sfa-msg-a',
      userId: ownerId,
    });
    await serverDB.insert(topicShares).values({
      id: 'sfa-share-b',
      topicId: 'sfa-topic-b',
      userId: ownerId,
      visibility: 'link',
    });

    await expect(
      resolveShareFileAccess({
        db: serverDB,
        fileId: 'sfa-file-wrong-topic',
        shareId: 'sfa-share-b',
      }),
    ).resolves.toBe(false);
  });

  it('denies an unknown share id', async () => {
    await serverDB
      .insert(topics)
      .values({ id: 'sfa-topic-known', title: 'Known', userId: ownerId });
    await serverDB.insert(messages).values({
      content: 'known',
      id: 'sfa-msg-known',
      role: 'user',
      topicId: 'sfa-topic-known',
      userId: ownerId,
    });
    await serverDB.insert(files).values(fileOf('sfa-file-known'));
    await serverDB.insert(messagesFiles).values({
      fileId: 'sfa-file-known',
      messageId: 'sfa-msg-known',
      userId: ownerId,
    });
    await serverDB.insert(topicShares).values({
      id: 'sfa-share-known',
      topicId: 'sfa-topic-known',
      userId: ownerId,
      visibility: 'link',
    });

    await expect(
      resolveShareFileAccess({
        db: serverDB,
        fileId: 'sfa-file-known',
        shareId: 'sfa-share-does-not-exist',
      }),
    ).resolves.toBe(false);
  });
});
