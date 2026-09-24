import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { dingtalkDocsService } from './dingtalkDocs';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    dingtalkDocs: {
      callTool: { mutate: vi.fn() },
      preview: { query: vi.fn() },
    },
  },
}));

const client = (lambdaClient as any).dingtalkDocs;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dingtalkDocsService', () => {
  it('forwards a tool call as one mutation and returns the server output as-is', async () => {
    const state = { hasMore: false, items: [], kind: 'docs' };
    const output = { content: '{}', state, success: true };
    client.callTool.mutate.mockResolvedValueOnce(output);

    await expect(
      dingtalkDocsService.callTool({ apiName: 'searchDocs', args: { query: '周报' } } as any),
    ).resolves.toBe(output);
    expect(client.callTool.mutate).toHaveBeenCalledWith({
      apiName: 'searchDocs',
      args: { query: '周报' },
    });
  });

  it('reads the preview of a write as a query', async () => {
    const preview = {
      danger: false,
      lines: ['1. 张三 | 销售部 | 50000'],
      title: '向「9月」追加 1 行',
      warnings: [],
    };
    client.preview.query.mockResolvedValueOnce(preview);

    const args = { nodeId: 'node_1', rows: [['张三', '销售部', 50_000]], sheetId: 'st_1' };
    await expect(
      dingtalkDocsService.preview({ apiName: 'appendSheetRows', args } as any),
    ).resolves.toEqual(preview);
    expect(client.preview.query).toHaveBeenCalledWith({ apiName: 'appendSheetRows', args });
  });

  it('lets a transport failure reach the caller', async () => {
    client.preview.query.mockRejectedValueOnce(new Error('DINGTALK_PERSONAL_EXPIRED'));

    await expect(
      dingtalkDocsService.preview({ apiName: 'createDoc', args: {} } as any),
    ).rejects.toThrow('DINGTALK_PERSONAL_EXPIRED');
  });
});
