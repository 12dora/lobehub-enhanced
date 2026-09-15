// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { notifyAfterTopicComplete, TaskNotificationService } from './index';

const { mockFindById, mockFindByTaskId } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockFindByTaskId: vi.fn(),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn().mockImplementation(() => ({
    findById: mockFindById,
  })),
}));

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn().mockImplementation(() => ({
    findByTaskId: mockFindByTaskId,
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(),
}));

vi.mock('@/database/models/notification', () => ({
  NotificationModel: vi.fn(),
}));

vi.mock('@/server/services/messenger/push', () => ({
  MessengerPushService: vi.fn(),
}));

const db = {} as LobeChatDatabase;
const base = {
  db,
  lastAssistantContent: 'final assistant output',
  taskId: 'task-1',
  taskIdentifier: 'T-1',
  topicId: 'topic-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
};

describe('notifyAfterTopicComplete', () => {
  let notifySpy: MockInstance<TaskNotificationService['notify']>;

  beforeEach(() => {
    vi.clearAllMocks();
    notifySpy = vi.spyOn(TaskNotificationService.prototype, 'notify').mockResolvedValue(undefined);
    mockFindByTaskId.mockResolvedValue([]);
    mockFindById.mockResolvedValue({
      assigneeAgentId: 'agt-1',
      instruction: 'write the digest',
      name: 'Daily report',
      status: 'scheduled',
    });
  });

  afterEach(() => {
    notifySpy.mockRestore();
  });

  it('(a) successful run → task_run_completed with last assistant output', async () => {
    await notifyAfterTopicComplete({ ...base, reason: 'done' });

    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'final assistant output',
        type: 'task_run_completed',
      }),
    );
  });

  it('(a) falls back to the handoff summary when last assistant output is empty', async () => {
    mockFindByTaskId.mockResolvedValue([
      { handoff: { summary: 'handoff summary' }, topicId: 'topic-1' },
    ]);

    await notifyAfterTopicComplete({ ...base, lastAssistantContent: '  ', reason: 'done' });

    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'handoff summary',
        type: 'task_run_completed',
      }),
    );
  });

  it('(b) error → task_run_failed with error text', async () => {
    await notifyAfterTopicComplete({
      ...base,
      errorMessage: 'model 429',
      reason: 'error',
    });

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'model 429',
        type: 'task_run_failed',
      }),
    );
  });

  it('(c) waiting_for_human → task_waiting_for_user with the question', async () => {
    await notifyAfterTopicComplete({
      ...base,
      lastAssistantContent: 'Should I proceed with X?',
      reason: 'waiting_for_human',
    });

    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Should I proceed with X?',
        type: 'task_waiting_for_user',
      }),
    );
  });

  it('(c) successful run that paused for review → also task_waiting_for_user', async () => {
    mockFindById.mockResolvedValue({
      assigneeAgentId: 'agt-1',
      instruction: 'write the digest',
      name: 'Daily report',
      status: 'paused',
    });

    await notifyAfterTopicComplete({ ...base, reason: 'done' });

    expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'task_run_completed' }));
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'task_waiting_for_user' }),
    );
  });

  it('(d) successful run that completed the task → also task_completed', async () => {
    mockFindById.mockResolvedValue({
      assigneeAgentId: 'agt-1',
      instruction: 'write the digest',
      name: 'Daily report',
      status: 'completed',
    });

    await notifyAfterTopicComplete({ ...base, reason: 'done' });

    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'write the digest',
        type: 'task_completed',
      }),
    );
  });

  it('never throws', async () => {
    mockFindById.mockRejectedValue(new Error('db down'));
    await expect(notifyAfterTopicComplete({ ...base, reason: 'done' })).resolves.toBeUndefined();
  });

  it('(b) error with no message → 未知错误', async () => {
    await notifyAfterTopicComplete({
      ...base,
      lastAssistantContent: '',
      reason: 'error',
    });

    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '未知错误',
        type: 'task_run_failed',
      }),
    );
  });
});
