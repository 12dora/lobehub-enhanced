// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runDingtalkDocsTool = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/builtin-tool-dingtalk-docs/manifest', () => ({
  DingtalkDocsIdentifier: 'lobe-dingtalk-docs',
}));

vi.mock('@lobechat/builtin-tool-dingtalk-docs/executionRuntime', () => ({
  createDingtalkDocsRuntime: (
    caller: { call: (apiName: string, args: Record<string, unknown>) => Promise<unknown> },
    options?: { resolveLink?: (path: string) => string },
  ) => ({
    resolveLink: options?.resolveLink,
    searchDocs: (args: Record<string, unknown> = {}) => caller.call('searchDocs', args),
  }),
}));

vi.mock('@/server/enterprise/services/dingtalkDocs/tool', () => ({
  runDingtalkDocsTool,
}));

const { dingtalkDocsRuntime } = await import('./dingtalkDocs');

beforeEach(() => {
  runDingtalkDocsTool.mockReset();
  runDingtalkDocsTool.mockResolvedValue({ content: 'ok', success: true });
});

describe('dingtalkDocsRuntime', () => {
  it('passes botThreadId from the tool execution context into the domain handler', async () => {
    const runtime = await dingtalkDocsRuntime.factory({
      botPlatform: 'dingtalk',
      botThreadId: 'dingtalk:cid_group:staff_1',
      serverDB: { tag: 'db' },
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
    } as never);

    await runtime.searchDocs({ query: '周报' });

    expect(runDingtalkDocsTool).toHaveBeenCalledWith(
      { tag: 'db' },
      'user-1',
      'searchDocs',
      { query: '周报' },
      {
        botPlatform: 'dingtalk',
        botThreadId: 'dingtalk:cid_group:staff_1',
        resolveLink: expect.any(Function),
        topicId: 'topic-1',
        workspaceId: 'ws-1',
      },
    );
  });

  it('rejects a factory call without a user', async () => {
    await expect(dingtalkDocsRuntime.factory({ serverDB: {} } as never)).rejects.toThrow(/userId/);
  });
});
