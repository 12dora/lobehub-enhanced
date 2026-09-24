import { describe, expect, it } from 'vitest';

import { DingtalkPersonalManifest } from './manifest';
import { systemPrompt } from './systemRole';

describe('dingtalk personal systemRole', () => {
  it('is attached to the manifest and is Chinese', () => {
    expect(DingtalkPersonalManifest.systemRole).toBe(systemPrompt);
    expect(systemPrompt).toContain('钉钉个人数据');
    expect(systemPrompt).toContain('当前用户本人');
    expect(systemPrompt).not.toMatch(/You have DingTalk/);
  });

  it('reads only the current user and keeps approvals on the approval tool', () => {
    expect(systemPrompt).toContain('不要声称能读取其他任何人');
    expect(systemPrompt).toContain('我的待办');
    expect(systemPrompt).toContain('全部待办');
    expect(systemPrompt).toContain('listMyTodos');
    expect(systemPrompt).toContain('钉钉客户端');
    expect(systemPrompt).toContain('lobe-dingtalk-approval');
  });

  it('splits group reads at 7 days and 500 messages, then downloads files', () => {
    expect(systemPrompt).toContain('searchGroups');
    expect(systemPrompt).toContain('不要猜测');
    expect(systemPrompt).toContain('listGroupMessages');
    expect(systemPrompt).toContain('7 天');
    expect(systemPrompt).toContain('500');
    expect(systemPrompt).toContain('searchMessages');
    expect(systemPrompt).toContain('downloadMessageFile');
  });

  it('drafts reports from template field names and confirms writes once', () => {
    expect(systemPrompt).toContain('listReportTemplates');
    expect(systemPrompt).toContain('getReportTemplate');
    expect(systemPrompt).toContain('字段名完全一致');
    expect(systemPrompt).toContain('不要编造');
    expect(systemPrompt).toContain('lobe-dingtalk-workspace');
    expect(systemPrompt).toContain('searchDirectory');
    expect(systemPrompt).toContain('submitReport');
    expect(systemPrompt).toContain('180');
    expect(systemPrompt).toContain('20 天');
    expect(systemPrompt).toContain('updateTodo');
    expect(systemPrompt).toContain('completeTodo');
    expect(systemPrompt).toContain('确认卡片');
    expect(systemPrompt).toContain('不要在文字里再问一次');
  });

  it('relays authorization errors verbatim in one sentence', () => {
    expect(systemPrompt).toContain('一句话');
    expect(systemPrompt).toContain('原样转达');
    expect(systemPrompt).toContain(
      '工具结果里有授权链接时，回复中必须原样给出该 markdown 链接（不要改写、截断或省略 URL），并用一句话说明授权后再问一次即可。',
    );
  });
});
