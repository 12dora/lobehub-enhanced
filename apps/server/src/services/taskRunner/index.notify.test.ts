// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from './index';

const {
  mockExecAgent,
  mockNotify,
  mockNotifyAfterTopicComplete,
  mockBuildTaskPrompt,
  mockOnTopicComplete,
} = vi.hoisted(() => ({
  mockBuildTaskPrompt: vi.fn(),
  mockExecAgent: vi.fn(),
  mockNotify: vi.fn(),
  mockNotifyAfterTopicComplete: vi.fn(),
  mockOnTopicComplete: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentModelConfig: vi.fn().mockResolvedValue(null),
    getBuiltinAgent: vi.fn(),
  })),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(),
}));

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    execAgent: mockExecAgent,
  })),
}));

vi.mock('@/server/services/taskLifecycle', () => ({
  TaskLifecycleService: vi.fn().mockImplementation(() => ({
    onTopicComplete: mockOnTopicComplete,
  })),
}));

vi.mock('@/server/services/taskNotification', () => ({
  notifyAfterTopicComplete: mockNotifyAfterTopicComplete,
  TaskNotificationService: vi.fn().mockImplementation(() => ({
    notify: mockNotify,
  })),
}));

vi.mock('./buildTaskPrompt', () => ({
  buildTaskPrompt: mockBuildTaskPrompt,
}));

describe('TaskRunnerService notify hooks', () => {
  const db = {} as LobeChatDatabase;
  const userId = 'user-1';

  const mockTaskModel = {
    getCheckpointConfig: vi.fn().mockReturnValue({}),
    getReviewConfig: vi.fn().mockReturnValue(undefined),
    incrementTopicCount: vi.fn(),
    resolve: vi.fn(),
    update: vi.fn(),
    updateCurrentTopic: vi.fn(),
    updateHeartbeat: vi.fn(),
    updateStatus: vi.fn(),
    updateTaskConfig: vi.fn(),
  };

  const mockTaskTopicModel = {
    add: vi.fn(),
    findByTaskId: vi.fn().mockResolvedValue([]),
    timeoutRunning: vi.fn(),
    updateOperationId: vi.fn(),
    updateStatus: vi.fn(),
  };

  const baseTask = {
    assigneeAgentId: 'agt-1',
    automationMode: null,
    config: { model: 'gpt', provider: 'openai' },
    currentTopicId: null,
    error: null,
    heartbeatTimeout: null,
    id: 'task-1',
    identifier: 'T-1',
    lastHeartbeatAt: null,
    name: 'Daily report',
    status: 'paused',
    totalTopics: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNotify.mockResolvedValue(undefined);
    mockNotifyAfterTopicComplete.mockResolvedValue(undefined);
    mockOnTopicComplete.mockResolvedValue(undefined);
    mockBuildTaskPrompt.mockResolvedValue({ fileIds: [], prompt: 'do the thing' });
    mockTaskModel.getCheckpointConfig.mockReturnValue({});
    mockTaskModel.getReviewConfig.mockReturnValue(undefined);
    mockTaskTopicModel.findByTaskId.mockResolvedValue([]);
    (TaskModel as any).mockImplementation(() => mockTaskModel);
    (TaskTopicModel as any).mockImplementation(() => mockTaskTopicModel);
  });

  it('onComplete handler calls notifyAfterTopicComplete', async () => {
    mockTaskModel.resolve.mockResolvedValue({ ...baseTask });
    mockExecAgent.mockImplementation(
      async ({
        hooks,
      }: {
        hooks: Array<{
          handler: (event: {
            lastAssistantContent?: string;
            operationId: string;
            reason?: string;
            topicId?: string;
          }) => Promise<void>;
        }>;
      }) => {
        await hooks[0].handler({
          lastAssistantContent: 'final output',
          operationId: 'op-1',
          reason: 'done',
          topicId: 'topic-1',
        });
        return { operationId: 'op-1', topicId: 'topic-1' };
      },
    );

    const runner = new TaskRunnerService(db, userId);
    await runner.runTask({ taskId: 'task-1' });

    expect(mockNotifyAfterTopicComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        lastAssistantContent: 'final output',
        reason: 'done',
        taskId: 'task-1',
        topicId: 'topic-1',
        userId,
      }),
    );
  });

  it('catch on a failed kickoff calls TaskNotificationService.notify', async () => {
    mockTaskModel.resolve
      .mockResolvedValueOnce({ ...baseTask, status: 'paused' })
      .mockResolvedValueOnce({ ...baseTask, status: 'running' });
    mockExecAgent.mockRejectedValue(new Error('kickoff boom'));

    const runner = new TaskRunnerService(db, userId);
    await expect(runner.runTask({ taskId: 'task-1' })).rejects.toThrow('kickoff boom');

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'kickoff boom',
        taskId: 'task-1',
        type: 'task_run_failed',
        userId,
      }),
    );
  });
});
