// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { TaskNotificationService } from './index';

const { mockGetUserSettings, mockCreate, mockCreateDelivery, mockFindByDedupeKey, mockPushToUser } =
  vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockCreateDelivery: vi.fn(),
    mockFindByDedupeKey: vi.fn(),
    mockGetUserSettings: vi.fn(),
    mockPushToUser: vi.fn(),
  }));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: mockGetUserSettings,
  })),
}));

vi.mock('@/database/models/notification', () => ({
  NotificationModel: vi.fn().mockImplementation(() => ({
    create: mockCreate,
    createDelivery: mockCreateDelivery,
    findByDedupeKey: mockFindByDedupeKey,
  })),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn().mockImplementation(() => ({
    findById: vi.fn(),
  })),
}));

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn().mockImplementation(() => ({
    findByTaskId: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/messenger/push', () => ({
  MessengerPushService: vi.fn().mockImplementation(() => ({
    pushToUser: mockPushToUser,
  })),
}));

const db = {} as LobeChatDatabase;
const baseInput = {
  content: 'Run finished **ok**',
  db,
  taskId: 'task-1',
  taskIdentifier: 'T-1',
  taskName: 'Daily report',
  topicId: 'topic-1',
  type: 'task_run_completed' as const,
  userId: 'user-1',
};

describe('TaskNotificationService.notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserSettings.mockResolvedValue(undefined);
    mockFindByDedupeKey.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'n-1' });
    mockCreateDelivery.mockResolvedValue({ id: 'd-1' });
    mockPushToUser.mockResolvedValue({ status: 'sent', providerMessageId: 'dt-1' });
  });

  it('creates inbox + dingtalk deliveries when both channels are on', async () => {
    await new TaskNotificationService().notify(baseInput);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        actionUrl: '/task/task-1',
        category: 'task',
        dedupeKey: 'task:task-1:task_run_completed:topic-1',
        isArchived: false,
        title: 'Daily report',
        type: 'task_run_completed',
      }),
    );
    expect(mockCreateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'inbox', notificationId: 'n-1', status: 'sent' }),
    );
    expect(mockPushToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'dingtalk',
        userId: 'user-1',
        message: expect.objectContaining({
          actionLabel: '在 AIHub 中查看',
          actionUrl: '/task/task-1',
          title: '任务已完成一次运行 · Daily report',
        }),
      }),
    );
    expect(mockCreateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'dingtalk',
        notificationId: 'n-1',
        providerMessageId: 'dt-1',
        status: 'sent',
      }),
    );
  });

  it('inbox-only: no dingtalk push', async () => {
    mockGetUserSettings.mockResolvedValue({
      notification: { dingtalk: { enabled: false } },
    });

    await new TaskNotificationService().notify(baseInput);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isArchived: false }));
    expect(mockPushToUser).not.toHaveBeenCalled();
    expect(mockCreateDelivery).toHaveBeenCalledTimes(1);
    expect(mockCreateDelivery).toHaveBeenCalledWith(expect.objectContaining({ channel: 'inbox' }));
  });

  it('dingtalk-only: archives the parent so it does not surface in the bell', async () => {
    mockGetUserSettings.mockResolvedValue({
      notification: { inbox: { enabled: false } },
    });

    await new TaskNotificationService().notify(baseInput);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isArchived: true }));
    expect(mockCreateDelivery).not.toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'inbox' }),
    );
    expect(mockPushToUser).toHaveBeenCalled();
    expect(mockCreateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'dingtalk', status: 'sent' }),
    );
  });

  it('records a failed dingtalk delivery', async () => {
    mockPushToUser.mockResolvedValue({ status: 'failed', error: 'timeout' });

    await new TaskNotificationService().notify(baseInput);

    expect(mockCreateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'dingtalk',
        failedReason: 'timeout',
        status: 'failed',
      }),
    );
  });

  it('writes no dingtalk delivery row when push is skipped', async () => {
    mockPushToUser.mockResolvedValue({ status: 'skipped', reason: 'user_not_mapped' });

    await new TaskNotificationService().notify(baseInput);

    const channels = mockCreateDelivery.mock.calls.map((call) => call[0].channel);
    expect(channels).toEqual(['inbox']);
  });

  it('does not insert an archived parent when dingTalk-only push is skipped', async () => {
    mockGetUserSettings.mockResolvedValue({
      notification: { inbox: { enabled: false } },
    });
    mockPushToUser.mockResolvedValue({ status: 'skipped', reason: 'user_not_mapped' });

    await new TaskNotificationService().notify(baseInput);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateDelivery).not.toHaveBeenCalled();
  });

  it('uses a stable kickoff suffix when topicId is missing', async () => {
    await new TaskNotificationService().notify({ ...baseInput, topicId: undefined });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'task:task-1:task_run_completed:kickoff' }),
    );
  });

  it('uses heartbeat-timeout when topicId is missing and content is a heartbeat failure', async () => {
    await new TaskNotificationService().notify({
      ...baseInput,
      content: 'Heartbeat timeout',
      topicId: undefined,
      type: 'task_run_failed',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '心跳超时',
        dedupeKey: 'task:task-1:task_run_failed:heartbeat-timeout',
      }),
    );
  });

  it('uses operationId as the suffix when topicId is missing', async () => {
    await new TaskNotificationService().notify({
      ...baseInput,
      operationId: 'op-99',
      topicId: undefined,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'task:task-1:task_run_completed:op-99' }),
    );
  });

  it('localizes Unknown error to 未知错误', async () => {
    await new TaskNotificationService().notify({
      ...baseInput,
      content: 'Unknown error',
      type: 'task_run_failed',
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ content: '未知错误' }));
  });

  it('skips the whole write when both channels are off', async () => {
    mockGetUserSettings.mockResolvedValue({
      notification: { dingtalk: { enabled: false }, inbox: { enabled: false } },
    });

    await new TaskNotificationService().notify(baseInput);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPushToUser).not.toHaveBeenCalled();
  });

  it('dedupes on (taskId, type, topicId)', async () => {
    mockFindByDedupeKey.mockResolvedValue({ id: 'existing' });

    await new TaskNotificationService().notify(baseInput);
    await new TaskNotificationService().notify(baseInput);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPushToUser).not.toHaveBeenCalled();
  });

  it('truncates inbox content to 2000 chars', async () => {
    await new TaskNotificationService().notify({
      ...baseInput,
      content: 'z'.repeat(2500),
    });

    expect(mockCreate.mock.calls[0][0].content).toHaveLength(2000);
  });

  it('never throws into the caller', async () => {
    mockGetUserSettings.mockRejectedValue(new Error('db down'));

    await expect(new TaskNotificationService().notify(baseInput)).resolves.toBeUndefined();
  });

  it('falls back to the identifier when the task name is blank', async () => {
    await new TaskNotificationService().notify({ ...baseInput, taskName: '  ' });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ title: 'T-1' }));
  });
});
