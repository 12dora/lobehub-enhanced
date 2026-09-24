import { BuiltinToolManifestSchema } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { DingtalkPersonalManifest } from './manifest';
import { DingtalkPersonalApiName, DingtalkPersonalWriteApiNames } from './types';

const ALL_APIS = [
  'completeTodo',
  'completeTodos',
  'downloadMessageFile',
  'getReport',
  'getReportTemplate',
  'getTodo',
  'listGroupMessages',
  'listMyGroups',
  'listMyTodos',
  'listReportTemplates',
  'listReports',
  'searchGroups',
  'searchMessages',
  'submitReport',
  'updateTodo',
] as const;

const WRITE_APIS = ['completeTodo', 'completeTodos', 'submitReport', 'updateTodo'] as const;

describe('DingtalkPersonalManifest', () => {
  it('matches the builtin tool manifest schema', () => {
    const parsed = BuiltinToolManifestSchema.safeParse(DingtalkPersonalManifest);

    expect(parsed.success).toBe(true);
  });

  it('uses the stable lobe-dingtalk-personal identifier and all 15 APIs', () => {
    expect(DingtalkPersonalManifest.identifier).toBe('lobe-dingtalk-personal');
    expect(DingtalkPersonalManifest.type).toBe('builtin');
    expect(DingtalkPersonalManifest.meta.title).toBe('钉钉个人数据');
    expect(DingtalkPersonalManifest.meta.avatar).toBeTruthy();
    expect(DingtalkPersonalManifest.meta.description).toContain('待办');
    expect(Object.values(DingtalkPersonalApiName).slice().sort()).toEqual([...ALL_APIS].sort());
    expect(DingtalkPersonalManifest.api.map((item) => item.name).sort()).toEqual(
      [...ALL_APIS].sort(),
    );
  });

  it('sets humanIntervention always on exactly the four writes and never on reads', () => {
    const writes = DingtalkPersonalManifest.api
      .filter((api) => api.humanIntervention === 'always')
      .map((api) => api.name)
      .sort();
    const reads = DingtalkPersonalManifest.api
      .filter((api) => api.humanIntervention === 'never')
      .map((api) => api.name)
      .sort();

    expect(writes).toEqual([...WRITE_APIS].sort());
    expect([...DingtalkPersonalWriteApiNames].sort()).toEqual([...WRITE_APIS].sort());
    const writeSet = new Set<string>(WRITE_APIS);
    expect(reads).toEqual([...ALL_APIS].filter((name) => !writeSet.has(name)).sort());
    expect(writes.length + reads.length).toBe(DingtalkPersonalManifest.api.length);
  });

  it('tells the model the message, report, and template limits in Chinese', () => {
    const byName = Object.fromEntries(DingtalkPersonalManifest.api.map((api) => [api.name, api]));

    expect(byName.listGroupMessages.description).toContain('7 天');
    expect(byName.listGroupMessages.description).toContain('500');
    expect(byName.listGroupMessages.parameters.properties.maxMessages.maximum).toBe(500);
    expect(byName.searchMessages.description).toContain('7 天');
    expect(byName.searchMessages.description).toContain('不是按群名搜索');
    expect(byName.searchMessages.description).toContain('listGroupMessages');
    expect(byName.searchMessages.parameters.properties.query.description).toContain('不是群名');
    expect(byName.completeTodos.description).toContain('completeTodos');
    expect(byName.completeTodos.description).toContain('不要并行');
    expect(byName.completeTodo.description).toContain('completeTodos');
    expect(byName.completeTodos.parameters.properties.taskIds.minItems).toBe(1);
    expect(byName.completeTodos.parameters.properties.taskIds.maxItems).toBe(20);
    expect(byName.listReports.description).toContain('180');
    expect(byName.listReports.description).toContain('20 天');
    expect(byName.listReports.parameters.properties.box.enum).toEqual(['inbox', 'outbox']);
    expect(byName.getReportTemplate.description).toContain('字段名');
    expect(byName.submitReport.description).toContain('字段名完全一致');
    expect(byName.submitReport.parameters.properties.contents.maxItems).toBe(20);
    expect(byName.submitReport.parameters.properties.toUserIds.maxItems).toBe(20);
  });

  it('requires the write payloads and rejects extra properties', () => {
    const updateTodo = DingtalkPersonalManifest.api.find((api) => api.name === 'updateTodo');
    const completeTodo = DingtalkPersonalManifest.api.find((api) => api.name === 'completeTodo');
    const completeTodos = DingtalkPersonalManifest.api.find((api) => api.name === 'completeTodos');
    const submitReport = DingtalkPersonalManifest.api.find((api) => api.name === 'submitReport');

    expect(updateTodo?.parameters.required).toEqual(['taskId']);
    expect(updateTodo?.parameters.minProperties).toBe(2);
    expect(updateTodo?.parameters.additionalProperties).toBe(false);
    expect(updateTodo?.parameters.properties.priority.enum).toEqual([10, 20, 30, 40]);
    expect(completeTodo?.parameters.required).toEqual(['taskId']);
    expect(completeTodo?.parameters.additionalProperties).toBe(false);
    expect(completeTodos?.parameters.required).toEqual(['taskIds']);
    expect(completeTodos?.parameters.additionalProperties).toBe(false);
    expect(completeTodos?.humanIntervention).toBe('always');
    expect(submitReport?.parameters.required).toEqual(['templateName', 'contents', 'toUserIds']);
    expect(submitReport?.parameters.additionalProperties).toBe(false);
  });
});
