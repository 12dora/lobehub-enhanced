// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { briefRuntime } from '../brief';

const { mockUpdateStatus, mockFindById, mockBriefCreate, mockNotify } = vi.hoisted(() => ({
  mockBriefCreate: vi.fn(),
  mockFindById: vi.fn(),
  mockNotify: vi.fn(),
  mockUpdateStatus: vi.fn(),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn().mockImplementation(() => ({
    create: mockBriefCreate,
  })),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn().mockImplementation(() => ({
    findById: mockFindById,
    updateStatus: mockUpdateStatus,
  })),
}));

vi.mock('@/server/services/taskNotification', () => ({
  TaskNotificationService: vi.fn().mockImplementation(() => ({
    notify: mockNotify,
  })),
}));

describe('briefRuntime.requestCheckpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBriefCreate.mockResolvedValue({ id: 'brief-1' });
    mockUpdateStatus.mockResolvedValue(undefined);
    mockNotify.mockResolvedValue(undefined);
    mockFindById.mockResolvedValue({
      assigneeAgentId: 'agt-1',
      createdByUserId: 'owner-1',
      identifier: 'T-1',
      name: 'Checkpoint task',
    });
  });

  it('pauses the task and notifies the owner with the checkpoint reason', async () => {
    const runtime = briefRuntime.factory({
      agentId: 'agt-1',
      operationId: 'op-1',
      serverDB: {} as any,
      toolManifestMap: {},
      taskId: 'task-1',
      topicId: 'topic-1',
      userId: 'runner-1',
      workspaceId: 'ws-1',
    });

    const result = await runtime.requestCheckpoint({ reason: 'Need a decision on X' });

    expect(result.success).toBe(true);
    expect(mockUpdateStatus).toHaveBeenCalledWith('task-1', 'paused');
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Need a decision on X',
        operationId: 'op-1',
        taskId: 'task-1',
        topicId: 'topic-1',
        type: 'task_waiting_for_user',
        userId: 'owner-1',
      }),
    );
  });
});
