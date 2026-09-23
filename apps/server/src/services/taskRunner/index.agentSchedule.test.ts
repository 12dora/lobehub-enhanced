// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

import { TaskRunnerService } from './index';

const { mockBuildTaskPrompt, mockExecAgent } = vi.hoisted(() => ({
  mockBuildTaskPrompt: vi.fn(),
  mockExecAgent: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentModelConfig: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(),
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
  TaskLifecycleService: vi.fn(),
}));

vi.mock('@/server/services/taskNotification', () => ({
  notifyAfterTopicComplete: vi.fn(),
  TaskNotificationService: vi.fn(),
}));

vi.mock('./buildTaskPrompt', () => ({
  buildTaskPrompt: mockBuildTaskPrompt,
}));

describe('TaskRunnerService agent schedule gate', () => {
  const db = {} as LobeChatDatabase;
  const scheduled = {
    assigneeAgentId: 'agt-1',
    automationMode: 'schedule',
    config: { model: 'gpt', provider: 'openai' },
    id: 'task-1',
    identifier: 'T-6',
    schedulePattern: '0 9 * * *',
    scheduleTimezone: 'Asia/Shanghai',
    status: 'backlog',
    totalTopics: 0,
  };

  const mockTaskModel = {
    getCheckpointConfig: vi.fn().mockReturnValue({}),
    getReviewConfig: vi.fn().mockReturnValue(undefined),
    incrementTopicCount: vi.fn(),
    resolve: vi.fn(),
    updateCurrentTopic: vi.fn(),
    updateHeartbeat: vi.fn(),
    updateStatus: vi.fn(),
  };

  const mockTaskTopicModel = {
    add: vi.fn(),
    findByTaskId: vi.fn().mockResolvedValue([]),
    timeoutRunning: vi.fn(),
    updateOperationId: vi.fn(),
    updateStatus: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T11:26:35.000Z'));
    mockTaskModel.resolve.mockResolvedValue(scheduled);
    mockTaskModel.getCheckpointConfig.mockReturnValue({});
    mockTaskTopicModel.findByTaskId.mockResolvedValue([]);
    mockBuildTaskPrompt.mockResolvedValue({ fileIds: [], prompt: 'go' });
    mockExecAgent.mockResolvedValue({ operationId: 'op-1', topicId: 'topic-1' });
    (
      TaskModel as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(() => mockTaskModel);
    (
      TaskTopicModel as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(() => mockTaskTopicModel);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses an agent runTask while the next fire is still in the future', async () => {
    const runner = new TaskRunnerService(db, 'user-1');

    await expect(runner.runTask({ requestedByAgent: true, taskId: 'T-6' })).rejects.toThrow(
      '已按计划在 2026-09-16 09:00 执行，无需立即运行',
    );
    expect(mockExecAgent).not.toHaveBeenCalled();
    expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
  });

  it('runs immediately when the agent sets runNow', async () => {
    const runner = new TaskRunnerService(db, 'user-1');

    const result = await runner.runTask({ requestedByAgent: true, runNow: true, taskId: 'T-6' });

    expect(mockExecAgent).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ taskIdentifier: 'T-6', topicId: 'topic-1' }));
  });
});
