// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskLifecycleService } from './index';

const noteRuntimeError = vi.hoisted(() => vi.fn());
const generateObject = vi.hoisted(() => vi.fn());

vi.mock('@/server/enterprise/services/platformSystem/noteRuntimeError', () => ({
  noteRuntimeError,
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(async () => ({ generateObject })),
}));

vi.mock('@/server/services/taskScheduler', () => ({
  createTaskSchedulerModule: () => ({
    cancelScheduled: vi.fn(),
    scheduleNextTopic: vi.fn(),
  }),
}));

vi.mock('@/database/models/verifyRun', () => ({
  VerifyRunModel: vi.fn(() => ({ findByOperation: vi.fn() })),
}));

vi.mock('../task', () => ({
  TaskService: vi.fn(() => ({ updateStatus: vi.fn() })),
}));

describe('TaskLifecycleService system-agent failures', () => {
  let service: TaskLifecycleService;

  beforeEach(() => {
    noteRuntimeError.mockClear();
    generateObject.mockReset();
    service = new TaskLifecycleService({} as never, 'user-1');
    vi.spyOn((service as any).systemAgentService, 'getTaskModelConfig').mockResolvedValue({
      model: 'gpt-5.4-mini',
      provider: 'chatgpt',
    });
    vi.spyOn((service as any).systemAgentService, 'getUserLocale').mockResolvedValue('zh-CN');
  });

  it('records handoff failures with the provider and model', async () => {
    const error = new Error('400 structured output');
    generateObject.mockRejectedValue(error);

    await (service as any).generateHandoff('task-1', 'TASK-1', 'topic-1', 'done', {
      instruction: 'write the note',
      name: 'weekly',
    });

    expect(noteRuntimeError).toHaveBeenCalledWith('system_agent', error, {
      model: 'gpt-5.4-mini',
      operation: 'handoff',
      provider: 'chatgpt',
    });
  });

  it('records a brief-judge failure separately from brief synthesis', async () => {
    const error = new Error('judge failed');
    generateObject.mockRejectedValue(error);
    (service as any).taskModel.getReviewConfig = vi.fn().mockReturnValue(undefined);
    (service as any).taskModel.getDocumentsPinnedSince = vi.fn().mockResolvedValue([]);
    (service as any).taskTopicModel.findByTopicId = vi.fn().mockResolvedValue({
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      handoff: null,
    });

    await (service as any).synthesizeTopicBrief(
      'task-1',
      'TASK-1',
      'topic-1',
      'A substantive assistant reply that is long enough to judge.',
      'complete',
      {
        automationMode: 'heartbeat',
        identifier: 'TASK-1',
        instruction: 'keep the loop',
        name: 'heartbeat',
      },
    );

    expect(noteRuntimeError).toHaveBeenCalledWith('system_agent', error, {
      model: 'gpt-5.4-mini',
      operation: 'briefJudge',
      provider: 'chatgpt',
    });
  });

  it('records brief synthesis when model config cannot be loaded', async () => {
    const error = new Error('config down');
    (service as any).systemAgentService.getTaskModelConfig.mockRejectedValue(error);
    (service as any).taskModel.getReviewConfig = vi.fn().mockReturnValue(undefined);
    (service as any).taskModel.getDocumentsPinnedSince = vi.fn().mockResolvedValue([]);
    (service as any).taskTopicModel.findByTopicId = vi.fn().mockResolvedValue(null);

    await (service as any).synthesizeTopicBrief(
      'task-1',
      'TASK-1',
      'topic-1',
      'A substantive assistant reply that is long enough to judge.',
      'complete',
      { automationMode: 'schedule', identifier: 'TASK-1', instruction: '', name: 'daily' },
    );

    expect(noteRuntimeError).toHaveBeenCalledWith('system_agent', error, {
      model: 'unknown',
      operation: 'brief',
      provider: 'unknown',
    });
  });
});
