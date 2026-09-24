import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { DingtalkPersonalApiName } from '../types';
import type { DingtalkPersonalRuntimeCaller } from './index';
import {
  createDingtalkPersonalRuntime,
  DINGTALK_PERSONAL_INTERNAL_TOOL_CONTENT,
  DingtalkPersonalExecutionRuntime,
} from './index';

const output: BuiltinServerRuntimeOutput = {
  content: '{"ok":true}',
  state: { kind: 'todos' },
  success: true,
};

const samples: Record<keyof typeof DingtalkPersonalApiName, object> = {
  completeTodo: { taskId: 'task-1' },
  downloadMessageFile: { resourceId: 'file-1', resourceType: 'fileId' },
  getReport: { reportId: 'report-1' },
  getReportTemplate: { name: '日报' },
  getTodo: { taskId: 'task-1' },
  listGroupMessages: {
    conversationId: 'cid-1',
    endTime: '2026-09-22T00:00:00+08:00',
    maxMessages: 200,
    startTime: '2026-09-21T00:00:00+08:00',
  },
  listMyGroups: { cursor: '20' },
  listMyTodos: { page: 2, status: 'open' },
  listReportTemplates: {},
  listReports: {
    box: 'inbox',
    cursor: 0,
    endTime: '2026-09-22T00:00:00+08:00',
    startTime: '2026-09-01T00:00:00+08:00',
  },
  searchGroups: { query: '库存' },
  searchMessages: { query: '日报' },
  submitReport: {
    contents: [{ content: '完成对账', key: '今日完成' }],
    templateName: '日报',
    toUserIds: ['staff-1'],
  },
  updateTodo: { dueTime: '2026-09-22T18:00:00+08:00', taskId: 'task-1', title: '交周报' },
};

describe('DingtalkPersonalExecutionRuntime', () => {
  it('delegates every API to call with the api name, args, and ctx', async () => {
    const call = vi.fn<DingtalkPersonalRuntimeCaller['call']>().mockResolvedValue(output);
    const runtime = createDingtalkPersonalRuntime({ call });
    const ctx = { botPlatform: 'dingtalk', topicId: 'topic-1' };

    expect(runtime).toBeInstanceOf(DingtalkPersonalExecutionRuntime);
    expect(Object.keys(samples).sort()).toEqual(Object.values(DingtalkPersonalApiName).sort());

    for (const [apiName, args] of Object.entries(samples)) {
      call.mockClear();
      const method = runtime[apiName as keyof DingtalkPersonalExecutionRuntime];
      expect(typeof method).toBe('function');

      const result = await (
        method as (args: object, ctx?: unknown) => Promise<BuiltinServerRuntimeOutput>
      ).call(runtime, args, ctx);

      expect(result).toEqual(output);
      expect(call).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledWith(apiName, args, ctx);
    }
  });

  it('forwards an omitted ctx and default empty args', async () => {
    const call = vi.fn<DingtalkPersonalRuntimeCaller['call']>().mockResolvedValue(output);
    const runtime = createDingtalkPersonalRuntime({ call });

    await runtime.listReportTemplates();
    expect(call).toHaveBeenCalledWith('listReportTemplates', {}, undefined);

    await runtime.listMyTodos();
    expect(call).toHaveBeenLastCalledWith('listMyTodos', {}, undefined);
  });

  it('exposes the sanitized internal-failure copy', () => {
    expect(DINGTALK_PERSONAL_INTERNAL_TOOL_CONTENT).toContain('内部错误');
    expect(DINGTALK_PERSONAL_INTERNAL_TOOL_CONTENT).not.toMatch(/stack|select /i);
  });
});
