// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runDingtalkPersonalTool = vi.hoisted(() => vi.fn());

vi.mock('@/server/enterprise/services/dingtalkPersonal/tool', () => ({
  runDingtalkPersonalTool,
}));

const { dingtalkPersonalRuntime } = await import('./dingtalkPersonal');

beforeEach(() => {
  runDingtalkPersonalTool.mockReset();
  runDingtalkPersonalTool.mockResolvedValue({ content: 'ok', success: true });
});

describe('dingtalkPersonalRuntime', () => {
  it('passes botThreadId from the tool execution context into the domain handler', async () => {
    const runtime = await dingtalkPersonalRuntime.factory({
      botPlatform: 'dingtalk',
      botThreadId: 'dingtalk:cid_group:staff_1',
      serverDB: { tag: 'db' },
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
    } as never);

    await runtime.listMyTodos({ status: 'open' });

    expect(runDingtalkPersonalTool).toHaveBeenCalledWith(
      { tag: 'db' },
      'user-1',
      'listMyTodos',
      { status: 'open' },
      {
        botPlatform: 'dingtalk',
        botThreadId: 'dingtalk:cid_group:staff_1',
        resolveLink: expect.any(Function),
        topicId: 'topic-1',
        workspaceId: 'ws-1',
      },
    );
  });

  it('forwards an unset botThreadId for web and other callers', async () => {
    const runtime = await dingtalkPersonalRuntime.factory({
      botPlatform: 'dingtalk',
      serverDB: { tag: 'db' },
      userId: 'user-1',
    } as never);

    await runtime.listMyTodos();

    expect(runDingtalkPersonalTool).toHaveBeenCalledWith(
      { tag: 'db' },
      'user-1',
      'listMyTodos',
      {},
      {
        botPlatform: 'dingtalk',
        botThreadId: undefined,
        resolveLink: expect.any(Function),
        topicId: undefined,
        workspaceId: undefined,
      },
    );
  });
});
