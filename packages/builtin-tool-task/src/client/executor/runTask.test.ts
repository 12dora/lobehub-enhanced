import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getChatStoreState: vi.fn(),
  getTaskStoreState: vi.fn(),
  run: vi.fn(),
}));

vi.mock('@/store/chat', () => ({
  getChatStoreState: mocks.getChatStoreState,
}));

vi.mock('@/store/task', () => ({
  getTaskStoreState: mocks.getTaskStoreState,
}));

vi.mock('@/store/task/slices/detail/reducer', () => ({
  findSubtaskParentId: vi.fn(() => undefined),
}));

vi.mock('@/services/task', () => ({
  taskService: { run: mocks.run },
}));

// Imported after mocks so the executor module resolves the stubbed service and stores.
const { taskExecutor } = await import('./index');

describe('TaskExecutor run APIs — agent-initiated runs', () => {
  beforeEach(() => {
    mocks.run.mockReset();
    mocks.run.mockResolvedValue({ operationId: 'op-1', topicId: 'tpc-1' });
    mocks.getTaskStoreState.mockReturnValue({
      internal_refreshTaskDetail: vi.fn().mockResolvedValue(undefined),
      refreshTaskList: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('marks runTask as agent-requested and does not force a scheduled run by default', async () => {
    const result = await taskExecutor.runTask({ identifier: 'T-1', prompt: 'Focus' });

    expect(result.success).toBe(true);
    expect(mocks.run).toHaveBeenCalledWith('T-1', {
      continueTopicId: undefined,
      prompt: 'Focus',
      requestedByAgent: true,
      runNow: false,
    });
  });

  it('passes runNow when the agent asked to run now', async () => {
    await taskExecutor.runTask({ identifier: 'T-1', runNow: true });

    expect(mocks.run).toHaveBeenCalledWith('T-1', expect.objectContaining({ runNow: true }));
  });

  it('treats force as an alias of runNow', async () => {
    await taskExecutor.runTask({ force: true, identifier: 'T-1' });

    expect(mocks.run).toHaveBeenCalledWith(
      'T-1',
      expect.objectContaining({ requestedByAgent: true, runNow: true }),
    );
  });

  it('surfaces the server refusal for a scheduled task as a failed tool result', async () => {
    mocks.run.mockRejectedValueOnce(
      new Error('Task T-1 is scheduled to run at 09:00; not started.'),
    );

    const result = await taskExecutor.runTask({ identifier: 'T-1' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('scheduled to run at 09:00');
  });

  it('marks every runTasks item as agent-requested and does not force by default', async () => {
    await taskExecutor.runTasks({ identifiers: ['T-1', 'T-2'] });

    expect(mocks.run).toHaveBeenNthCalledWith(1, 'T-1', { requestedByAgent: true, runNow: false });
    expect(mocks.run).toHaveBeenNthCalledWith(2, 'T-2', { requestedByAgent: true, runNow: false });
  });

  it('passes runNow to every runTasks item when the agent asked to run now', async () => {
    await taskExecutor.runTasks({ identifiers: ['T-1', 'T-2'], runNow: true });

    expect(mocks.run).toHaveBeenNthCalledWith(1, 'T-1', { requestedByAgent: true, runNow: true });
    expect(mocks.run).toHaveBeenNthCalledWith(2, 'T-2', { requestedByAgent: true, runNow: true });
  });

  it('only treats a literal true as runNow for runTasks', async () => {
    await taskExecutor.runTasks({
      identifiers: ['T-1'],
      runNow: 'true' as unknown as boolean,
    });

    expect(mocks.run).toHaveBeenCalledWith('T-1', { requestedByAgent: true, runNow: false });
  });
});
