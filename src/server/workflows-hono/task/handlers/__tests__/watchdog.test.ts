// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runWatchdogScan } from '../watchdog';

const { mockGetServerDB, mockFindStuckTasks, mockUpdateStatus, mockBriefCreate, mockNotify } =
  vi.hoisted(() => ({
    mockBriefCreate: vi.fn(),
    mockFindStuckTasks: vi.fn(),
    mockGetServerDB: vi.fn(),
    mockNotify: vi.fn(),
    mockUpdateStatus: vi.fn(),
  }));

vi.mock('@/database/server', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/task', () => {
  const TaskModel = vi.fn().mockImplementation(() => ({
    updateStatus: mockUpdateStatus,
  }));
  (TaskModel as any).findStuckTasks = mockFindStuckTasks;
  return { TaskModel };
});

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn().mockImplementation(() => ({
    create: mockBriefCreate,
  })),
}));

vi.mock('@/server/services/taskNotification', () => ({
  TaskNotificationService: vi.fn().mockImplementation(() => ({
    notify: mockNotify,
  })),
}));

describe('runWatchdogScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue({});
    mockUpdateStatus.mockResolvedValue(undefined);
    mockBriefCreate.mockResolvedValue({ id: 'brief-1' });
    mockNotify.mockResolvedValue(undefined);
  });

  it('notifies task_run_failed for each stuck task', async () => {
    mockFindStuckTasks.mockResolvedValue([
      {
        assigneeAgentId: 'agt-1',
        createdByUserId: 'owner-1',
        currentTopicId: null,
        heartbeatTimeout: 60,
        id: 'task-stuck',
        identifier: 'T-STUCK',
        name: 'Stuck',
        workspaceId: 'ws-1',
      },
    ]);

    const result = await runWatchdogScan();

    expect(result).toEqual({ checked: 1, failed: ['T-STUCK'] });
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Heartbeat timeout',
        taskId: 'task-stuck',
        type: 'task_run_failed',
        userId: 'owner-1',
      }),
    );
  });
});
