// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { agents, files, platformAgents, topics, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { resolveTargetLabels, targetLabelOf } from './targetLabelResolver';

const serverDB: LobeChatDatabase = await getTestDB();

const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz012345';

const IDS = {
  agent: 'tgt-lbl-agent',
  emptyTopic: 'tgt-lbl-topic-empty',
  file: 'tgt-lbl-file',
  platformAgent: 'pagt_tgt-lbl-plat',
  topic: 'tgt-lbl-topic',
  user: 'tgt-lbl-user',
  userEmail: 'tgt-lbl-user-email',
  userName: 'tgt-lbl-user-name',
};

const conversationEvidence = { canSeeConversationEvidence: true as const };

beforeEach(async () => {
  await serverDB.delete(files).where(eq(files.userId, IDS.user));
  await serverDB.delete(topics).where(eq(topics.userId, IDS.user));
  await serverDB.delete(agents).where(eq(agents.userId, IDS.user));
  await serverDB
    .delete(platformAgents)
    .where(inArray(platformAgents.id, [IDS.platformAgent, IDS.agent]));
  await serverDB.delete(users).where(eq(users.id, IDS.user));
  await serverDB.delete(users).where(eq(users.id, IDS.userEmail));
  await serverDB.delete(users).where(eq(users.id, IDS.userName));
  await serverDB.insert(users).values([
    { fullName: '邵军军', id: IDS.user, username: 'shao' },
    { email: 'alice@example.com', id: IDS.userEmail },
    { id: IDS.userName, username: 'only-name' },
  ]);
  await serverDB.insert(agents).values({
    id: IDS.agent,
    slug: 'support',
    title: 'Support Bot',
    userId: IDS.user,
  });
  await serverDB.insert(topics).values([
    { id: IDS.topic, title: 'Quarterly planning notes', userId: IDS.user },
    { id: IDS.emptyTopic, title: '   ', userId: IDS.user },
  ]);
  await serverDB.insert(files).values({
    fileType: 'application/pdf',
    id: IDS.file,
    name: 'invoice.pdf',
    size: 12,
    url: 's3://bucket/obj',
    userId: IDS.user,
  });
});

afterEach(async () => {
  await serverDB.delete(files).where(eq(files.userId, IDS.user));
  await serverDB.delete(topics).where(eq(topics.userId, IDS.user));
  await serverDB.delete(agents).where(eq(agents.userId, IDS.user));
  await serverDB
    .delete(platformAgents)
    .where(inArray(platformAgents.id, [IDS.platformAgent, IDS.agent]));
  await serverDB.delete(users).where(eq(users.id, IDS.user));
  await serverDB.delete(users).where(eq(users.id, IDS.userEmail));
  await serverDB.delete(users).where(eq(users.id, IDS.userName));
});

describe('resolveTargetLabels', () => {
  it('resolves topic, file, user, and agent display names', async () => {
    const labels = await resolveTargetLabels(
      serverDB,
      [
        { targetId: IDS.topic, targetType: 'topic' },
        { targetId: IDS.file, targetType: 'file' },
        { targetId: IDS.user, targetType: 'user' },
        { targetId: IDS.userEmail, targetType: 'user' },
        { targetId: IDS.userName, targetType: 'user' },
        { targetId: IDS.agent, targetType: 'agent' },
      ],
      conversationEvidence,
    );

    expect(targetLabelOf('topic', IDS.topic, labels)).toBe('Quarterly planning notes');
    expect(targetLabelOf('file', IDS.file, labels)).toBe('invoice.pdf');
    expect(targetLabelOf('user', IDS.user, labels)).toBe('邵军军');
    expect(targetLabelOf('user', IDS.userEmail, labels)).toBe('alice@example.com');
    expect(targetLabelOf('user', IDS.userName, labels)).toBe('only-name');
    expect(targetLabelOf('agent', IDS.agent, labels)).toBe('Support Bot');
  });

  it('omits topic and file labels without conversation-evidence access; user/agent stay resolved', async () => {
    const labels = await resolveTargetLabels(serverDB, [
      { targetId: IDS.topic, targetType: 'topic' },
      { targetId: IDS.file, targetType: 'file' },
      { targetId: IDS.user, targetType: 'user' },
      { targetId: IDS.agent, targetType: 'agent' },
    ]);

    expect(targetLabelOf('topic', IDS.topic, labels)).toBeNull();
    expect(targetLabelOf('file', IDS.file, labels)).toBeNull();
    expect(targetLabelOf('user', IDS.user, labels)).toBe('邵军军');
    expect(targetLabelOf('agent', IDS.agent, labels)).toBe('Support Bot');
  });

  it('omits missing ids, empty titles, unknown types, and the global sentinel', async () => {
    const labels = await resolveTargetLabels(
      serverDB,
      [
        { targetId: 'missing-topic', targetType: 'topic' },
        { targetId: 'missing-user', targetType: 'user' },
        { targetId: 'missing-agent', targetType: 'agent' },
        { targetId: IDS.emptyTopic, targetType: 'topic' },
        { targetId: 'global', targetType: 'topic' },
        { targetId: 'global', targetType: 'settings' },
        { targetId: IDS.user, targetType: 'settings' },
        { targetId: null, targetType: 'user' },
      ],
      conversationEvidence,
    );

    expect(labels.size).toBe(0);
    expect(targetLabelOf('topic', 'missing-topic', labels)).toBeNull();
    expect(targetLabelOf('topic', 'global', labels)).toBeNull();
    expect(targetLabelOf('settings', 'global', labels)).toBeNull();
    expect(targetLabelOf('user', null, labels)).toBeNull();
  });

  it('applies conversation redaction to topic and file labels', async () => {
    await serverDB
      .update(topics)
      .set({ title: `Keys ${SECRET} keep ACME` })
      .where(eq(topics.id, IDS.topic));
    await serverDB
      .update(files)
      .set({ name: `Keys ${SECRET} invoice.pdf` })
      .where(eq(files.id, IDS.file));

    const labels = await resolveTargetLabels(
      serverDB,
      [
        { targetId: IDS.topic, targetType: 'topic' },
        { targetId: IDS.file, targetType: 'file' },
      ],
      { ...conversationEvidence, redactionProfile: 'strict' },
    );
    const topicLabel = targetLabelOf('topic', IDS.topic, labels);
    const fileLabel = targetLabelOf('file', IDS.file, labels);
    expect(topicLabel).toContain('ACME');
    expect(topicLabel).not.toContain(SECRET);
    expect(topicLabel).toContain('[REDACTED]');
    expect(fileLabel).toContain('invoice.pdf');
    expect(fileLabel).not.toContain(SECRET);
    expect(fileLabel).toContain('[REDACTED]');
  });

  it('resolves leftover agent ids from platform_agents; titled agents rows win; missing stays null', async () => {
    await serverDB.insert(platformAgents).values([
      { agentKey: 'tgt-lbl-plat', id: IDS.platformAgent, title: 'Catalog Inbox' },
      { agentKey: 'tgt-lbl-agent-win', id: IDS.agent, title: 'Should Not Win' },
    ]);

    const labels = await resolveTargetLabels(serverDB, [
      { targetId: IDS.platformAgent, targetType: 'agent' },
      { targetId: IDS.agent, targetType: 'agent' },
      { targetId: 'pagt_missing', targetType: 'agent' },
    ]);

    expect(targetLabelOf('agent', IDS.platformAgent, labels)).toBe('Catalog Inbox');
    expect(targetLabelOf('agent', IDS.agent, labels)).toBe('Support Bot');
    expect(targetLabelOf('agent', 'pagt_missing', labels)).toBeNull();
  });
});
