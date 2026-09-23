// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runTask } = vi.hoisted(() => ({
  runTask: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(async () => ({})),
}));

vi.mock('@/server/services/taskRunner', () => ({
  TaskRunnerService: vi.fn().mockImplementation(() => ({ runTask })),
}));

const { taskRouter } = await import('../task');

describe('task.run', () => {
  const caller = taskRouter.createCaller({
    jwtPayload: { userId: 'user-1' },
    userId: 'user-1',
  } as never);

  beforeEach(() => {
    runTask.mockReset();
    runTask.mockResolvedValue({ success: true, taskId: 'task-1', taskIdentifier: 'T-1' });
  });

  it('forwards runNow and requestedByAgent to the runner', async () => {
    await caller.run({
      id: 'T-1',
      prompt: 'do it now',
      requestedByAgent: true,
      runNow: true,
    });

    expect(runTask).toHaveBeenCalledWith({
      continueTopicId: undefined,
      extraPrompt: 'do it now',
      requestedByAgent: true,
      runNow: true,
      taskId: 'T-1',
    });
  });

  it('leaves the schedule gate unset when the browser omits both flags', async () => {
    await caller.run({ id: 'T-1' });

    expect(runTask).toHaveBeenCalledWith({
      continueTopicId: undefined,
      extraPrompt: undefined,
      requestedByAgent: undefined,
      runNow: undefined,
      taskId: 'T-1',
    });
  });
});
