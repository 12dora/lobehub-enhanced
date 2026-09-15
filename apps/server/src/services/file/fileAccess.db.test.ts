// @vitest-environment node
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import {
  files,
  messages,
  messagesFiles,
  topics,
  topicShares,
  users,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { resolveFileAccess } from './fileAccess';

vi.mock('@/server/enterprise/featureFlags', () => ({
  isPlatformAdminFeatureEnabled: () => false,
}));

vi.mock('@/server/enterprise/services/moduleSettings', () => ({
  isModuleEnabled: vi.fn(async () => false),
}));

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'fa-acl-owner';
const memberId = 'fa-acl-member';
const attackerId = 'fa-acl-attacker';
const strangerId = 'fa-acl-stranger';
const workspaceId = 'fa-acl-ws';

const userIds = [ownerId, memberId, attackerId, strangerId];

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
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(inArray(users.id, userIds));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values(userIds.map((id) => ({ id })));
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'File Access WS',
    primaryOwnerId: ownerId,
    slug: 'fa-acl-ws',
  });
});

afterEach(cleanup);

describe('resolveFileAccess (real DB)', () => {
  it('allows the file owner', async () => {
    await serverDB.insert(files).values(fileOf('fa-acl-file-owner'));

    await expect(
      resolveFileAccess({
        db: serverDB,
        file: { id: 'fa-acl-file-owner', userId: ownerId, workspaceId: null },
        viewerUserId: ownerId,
      }),
    ).resolves.toEqual({ allowed: true, reason: 'owner' });
  });

  it('allows a workspace member when visibility is public', async () => {
    await new WorkspaceMemberModel(serverDB, ownerId).addMember({
      userId: memberId,
      workspaceId,
    });
    await serverDB
      .insert(files)
      .values(fileOf('fa-acl-file-public', { visibility: 'public', workspaceId }));

    await expect(
      resolveFileAccess({
        db: serverDB,
        file: {
          id: 'fa-acl-file-public',
          userId: ownerId,
          visibility: 'public',
          workspaceId,
        },
        viewerUserId: memberId,
      }),
    ).resolves.toEqual({ allowed: true, reason: 'workspace' });
  });

  it('denies a workspace member when visibility is private', async () => {
    await new WorkspaceMemberModel(serverDB, ownerId).addMember({
      userId: memberId,
      workspaceId,
    });
    await serverDB
      .insert(files)
      .values(fileOf('fa-acl-file-private', { visibility: 'private', workspaceId }));

    await expect(
      resolveFileAccess({
        db: serverDB,
        file: {
          id: 'fa-acl-file-private',
          userId: ownerId,
          visibility: 'private',
          workspaceId,
        },
        viewerUserId: memberId,
      }),
    ).resolves.toEqual({ allowed: false });
  });

  it('denies a soft-deleted workspace member even when visibility is public', async () => {
    const members = new WorkspaceMemberModel(serverDB, ownerId);
    await members.addMember({ userId: memberId, workspaceId });
    await members.removeMember(workspaceId, memberId);
    await serverDB
      .insert(files)
      .values(fileOf('fa-acl-file-deleted-member', { visibility: 'public', workspaceId }));

    const [deleted] = await serverDB
      .select()
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)),
      );
    expect(deleted?.deletedAt).not.toBeNull();

    await expect(
      resolveFileAccess({
        db: serverDB,
        file: {
          id: 'fa-acl-file-deleted-member',
          userId: ownerId,
          visibility: 'public',
          workspaceId,
        },
        viewerUserId: memberId,
      }),
    ).resolves.toEqual({ allowed: false });
  });

  it('allows a stranger when the owner attached the file and link-shared the topic', async () => {
    await serverDB
      .insert(topics)
      .values({ id: 'fa-acl-topic-link', title: 'Link', userId: ownerId });
    await serverDB.insert(messages).values({
      content: 'see this',
      id: 'fa-acl-msg-link',
      role: 'user',
      topicId: 'fa-acl-topic-link',
      userId: ownerId,
    });
    await serverDB.insert(files).values(fileOf('fa-acl-file-link'));
    await serverDB.insert(messagesFiles).values({
      fileId: 'fa-acl-file-link',
      messageId: 'fa-acl-msg-link',
      userId: ownerId,
    });
    await serverDB.insert(topicShares).values({
      id: 'fa-acl-share-link',
      topicId: 'fa-acl-topic-link',
      userId: ownerId,
      visibility: 'link',
    });

    await expect(
      resolveFileAccess({
        db: serverDB,
        file: { id: 'fa-acl-file-link', userId: ownerId, workspaceId: null },
        viewerUserId: strangerId,
      }),
    ).resolves.toEqual({ allowed: true, reason: 'topic_share' });
  });

  it('denies a stranger when the owner share is private rather than link', async () => {
    await serverDB
      .insert(topics)
      .values({ id: 'fa-acl-topic-private', title: 'Private', userId: ownerId });
    await serverDB.insert(messages).values({
      content: 'private',
      id: 'fa-acl-msg-private',
      role: 'user',
      topicId: 'fa-acl-topic-private',
      userId: ownerId,
    });
    await serverDB.insert(files).values(fileOf('fa-acl-file-private-share'));
    await serverDB.insert(messagesFiles).values({
      fileId: 'fa-acl-file-private-share',
      messageId: 'fa-acl-msg-private',
      userId: ownerId,
    });
    await serverDB.insert(topicShares).values({
      id: 'fa-acl-share-private',
      topicId: 'fa-acl-topic-private',
      userId: ownerId,
      visibility: 'private',
    });

    await expect(
      resolveFileAccess({
        db: serverDB,
        file: { id: 'fa-acl-file-private-share', userId: ownerId, workspaceId: null },
        viewerUserId: strangerId,
      }),
    ).resolves.toEqual({ allowed: false });
  });

  it('denies an attacker who attaches a victim fileId to their own link-shared topic', async () => {
    await serverDB.insert(files).values(fileOf('fa-acl-file-victim'));
    await serverDB
      .insert(topics)
      .values({ id: 'fa-acl-topic-attack', title: 'Attack', userId: attackerId });
    await serverDB.insert(messages).values({
      content: 'stolen',
      id: 'fa-acl-msg-attack',
      role: 'user',
      topicId: 'fa-acl-topic-attack',
      userId: attackerId,
    });
    await serverDB.insert(messagesFiles).values({
      fileId: 'fa-acl-file-victim',
      messageId: 'fa-acl-msg-attack',
      userId: attackerId,
    });
    await serverDB.insert(topicShares).values({
      id: 'fa-acl-share-attack',
      topicId: 'fa-acl-topic-attack',
      userId: attackerId,
      visibility: 'link',
    });

    await expect(
      resolveFileAccess({
        db: serverDB,
        file: { id: 'fa-acl-file-victim', userId: ownerId, workspaceId: null },
        viewerUserId: attackerId,
      }),
    ).resolves.toEqual({ allowed: false });

    await expect(
      resolveFileAccess({
        db: serverDB,
        file: { id: 'fa-acl-file-victim', userId: ownerId, workspaceId: null },
        viewerUserId: strangerId,
      }),
    ).resolves.toEqual({ allowed: false });
  });
});
