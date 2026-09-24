import { describe, expect, it } from 'vitest';

import { DingtalkWorkspaceManifest } from './manifest';
import { systemPrompt } from './systemRole';

describe('dingtalk workspace systemRole', () => {
  it('is attached to the manifest and is English', () => {
    expect(DingtalkWorkspaceManifest.systemRole).toBe(systemPrompt);
    expect(systemPrompt).toContain('You have DingTalk todo and calendar tools');
    expect(systemPrompt).not.toMatch(/你可以|请将返回/);
  });

  it('resolves relative dates against serverNow in Asia/Shanghai', () => {
    expect(systemPrompt).toContain('Asia/Shanghai');
    expect(systemPrompt).toContain('serverNow');
    expect(systemPrompt).toContain('下周三');
  });

  it('never guesses same-name colleagues and copies staff tokens verbatim', () => {
    expect(systemPrompt).toContain('姓名 · 部门');
    expect(systemPrompt).toContain('staff:<id>');
    expect(systemPrompt).toContain('verbatim');
    expect(systemPrompt).toContain('Never guess');
  });

  it('lists 我的待办 once, relays the visibility note, and confirms writes once', () => {
    expect(systemPrompt).toContain('我的待办');
    expect(systemPrompt).toContain('还有哪些待办');
    expect(systemPrompt).toContain('本助手创建的钉钉待办');
    expect(systemPrompt).toContain('call listTodos once');
    expect(systemPrompt).toContain('relay that note');
    expect(systemPrompt).toContain('do not also call lobe-dingtalk-approval listPendingApprovals');
    expect(systemPrompt).toContain('do not use tables');
    expect(systemPrompt).toContain('refresh=true');
    const listTodos = DingtalkWorkspaceManifest.api.find((api) => api.name === 'listTodos');
    expect(listTodos?.description).toBe(
      '我的钉钉待办：待我审批 + 本助手创建的待办。已授权钉钉个人数据时另含 personalTodos（含客户端自建待办，此处只读，写入走 lobe-dingtalk-personal 的 updateTodo/completeTodo，多条用 lobe-dingtalk-personal 的 completeTodos，一次调用）；notes 里的 markdown 链接必须原样转告，不要改写或编造 URL',
    );
    expect(systemPrompt).toContain('personalTodos');
    expect(systemPrompt).toContain('lobe-dingtalk-personal updateTodo/completeTodo');
    expect(systemPrompt).toContain('多条用 lobe-dingtalk-personal 的 completeTodos，一次调用');
    expect(systemPrompt).toContain('If notes say to authorize, relay that note');
    expect(listTodos?.parameters.properties).toHaveProperty('refresh');
    expect(systemPrompt).toContain('confirm card');
    expect(systemPrompt).toContain('completeTodos');
    expect(systemPrompt).toContain('deleteTodos');
    expect(systemPrompt).toContain('不要并行或逐条多次调用');
    expect(systemPrompt).not.toContain('never parallelize');
    expect(systemPrompt).toContain('successful write result is authoritative');
  });

  it('covers identity errors and disabled features', () => {
    expect(systemPrompt).toContain('DINGTALK_FEATURE_DISABLED');
    expect(systemPrompt).toContain('sign in with DingTalk');
    expect(systemPrompt).toContain('admins cannot bind');
  });

  it('requires the model to repeat an authorization markdown link verbatim', () => {
    expect(systemPrompt).toContain(
      '工具结果里的 markdown 链接必须原样转发（不要改写、截断、省略或自行编造 URL）。授权链接用一句话说明授权后再问一次即可。',
    );
    expect(systemPrompt).toContain('Do not invent a URL');
  });

  it('keeps free/busy titles stripped and organizer-only updates', () => {
    expect(systemPrompt).toContain('busy/free blocks only');
    expect(systemPrompt).toContain('organizer only');
    expect(systemPrompt).toContain('queryFreeBusy');
    expect(systemPrompt).toContain('listMeetingRooms');
    expect(systemPrompt).toContain('dueTime=null');
    expect(systemPrompt).toContain('roomIds replaces');
  });
});
