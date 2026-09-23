import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://chat.example.com' },
}));

const {
  buildDingTalkTopicDeepLink,
  formatDingTalkCardSendFailedContent,
  formatDingTalkConfirmSummary,
  formatDingTalkPreviewCard,
  formatDingTalkPreviewUnavailable,
} = await import('./confirmSummary');

describe('formatDingTalkConfirmSummary', () => {
  it('summarises saveTemplate the way the web confirm card does', () => {
    const summary = formatDingTalkConfirmSummary({
      apiName: 'saveTemplate',
      args: {
        fields: [
          { componentType: 'TextField', label: '项目名称' },
          { componentType: 'MoneyField', label: '金额' },
        ],
        name: '项目结案申请',
      },
    });
    expect(summary.title).toBe('创建模板「项目结案申请」');
    expect(summary.content).toContain('模板名称：项目结案申请');
    expect(summary.content).toContain('操作：创建');
    expect(summary.content).toContain('项目名称（TextField）');
    expect(summary.content).toContain('金额（MoneyField）');
  });

  it('lists every control flag and omits the template code when the name is present', () => {
    const summary = formatDingTalkConfirmSummary({
      apiName: 'saveTemplate',
      args: {
        description: '给项目结案用',
        fields: [
          {
            componentType: 'DDSelectField',
            defaultValue: '通过',
            label: '结果',
            options: ['通过', { label: '驳回', value: 'reject' }],
            required: true,
          },
          {
            children: [{ componentType: 'TextField', label: '明细', required: false }],
            componentType: 'TableField',
            label: '明细表',
            props: { unit: '元' },
          },
        ],
        name: '项目结案申请',
        processCode: 'PROC-9',
      },
    });
    expect(summary.content).not.toContain('PROC-9');
    expect(summary.content).not.toContain('模板编码');
    expect(summary.content).toContain('- 结果（DDSelectField，必填）');
    expect(summary.content).toContain('选项：通过、驳回（reject）');
    expect(summary.content).toContain('默认：通过');
    expect(summary.content).toContain('- 明细表（TableField）');
    expect(summary.content).toContain('单位：元');
    expect(summary.content).toContain('- 明细（TextField，选填）');
    expect(summary.content).toContain('说明：给项目结案用');
    expect(summary.content).not.toContain('|');
  });

  it('keeps user-submitted values, including ones that look like ids', () => {
    const summary = formatDingTalkConfirmSummary({
      apiName: 'approveTask',
      args: { comment: '同意结案', taskId: 'PROC-123' },
    });
    expect(summary.title).toBe('同意审批');
    expect(summary.content).toContain('同意结案');
    expect(summary.content).toContain('PROC-123');
  });

  it('hides an internal id when a human label for the same object is present', () => {
    const summary = formatDingTalkConfirmSummary({
      apiName: 'approveTask',
      args: {
        comment: '同意结案',
        processInstanceId: 'proc-inst-999',
        taskId: '99887766',
        title: '胡永静提交的付款审批单',
      },
    });
    expect(summary.content).toContain('标题：胡永静提交的付款审批单');
    expect(summary.content).toContain('意见：同意结案');
    expect(summary.content).not.toContain('99887766');
    expect(summary.content).not.toContain('proc-inst-999');
    expect(summary.content).not.toContain('taskId');
  });

  it('hides an event id when the summary is present, and a staff token when a name is', () => {
    const event = formatDingTalkConfirmSummary({
      apiName: 'deleteEvent',
      args: { eventId: 'evt-1', summary: '周会' },
    });
    expect(event.content).toContain('周会');
    expect(event.content).not.toContain('evt-1');

    const named = formatDingTalkConfirmSummary({
      apiName: 'transferTask',
      args: { toStaffName: '胡永静', toStaffToken: 'staff:abc' },
    });
    expect(named.content).toContain('胡永静');
    expect(named.content).not.toContain('staff:abc');

    const tokenOnly = formatDingTalkConfirmSummary({
      apiName: 'transferTask',
      args: { remark: '请处理', toStaffToken: 'staff:abc' },
    });
    expect(tokenOnly.content).toContain('staff:abc');
    expect(tokenOnly.content).toContain('请处理');
  });

  it('hides a dar_ rule id when the rule has a name, and keeps any other id', () => {
    const rule = formatDingTalkConfirmSummary({
      apiName: 'deleteApprovalRule',
      args: { id: 'dar_123', name: '自动同意' },
    });
    expect(rule.content).toContain('自动同意');
    expect(rule.content).not.toContain('dar_123');

    const other = formatDingTalkConfirmSummary({
      apiName: 'saveNote',
      args: { id: 'my-choice', name: '标签' },
    });
    expect(other.content).toContain('my-choice');
    expect(other.content).toContain('标签');
  });

  it('keeps a template code when no human name is present', () => {
    const summary = formatDingTalkConfirmSummary({
      apiName: 'saveTemplate',
      args: { fields: [], processCode: 'PROC-9' },
    });
    expect(summary.content).toContain('模板编码：PROC-9');
  });

  it('keeps field definitions, including ids inside a control', () => {
    const summary = formatDingTalkConfirmSummary({
      apiName: 'saveTemplate',
      args: {
        fields: [
          { componentId: 'TextField-PROC-1', componentType: 'TextField', label: '项目名称' },
        ],
        name: '项目结案申请',
      },
    });
    expect(summary.content).toContain('项目名称（TextField）');
    expect(summary.content).toContain('TextField-PROC-1');
  });
});

describe('formatDingTalkPreviewCard', () => {
  it('uses the resolved title and lines, and leads with the danger line', () => {
    const card = formatDingTalkPreviewCard(
      {
        apiName: 'refuseTask',
        args: { processInstanceId: 'proc-inst-999', remark: '金额不对', taskId: '99887766' },
      },
      {
        danger: true,
        lines: [
          { label: '审批单', value: '胡永静提交的付款审批单' },
          { label: '结果', value: '拒绝' },
          { label: '意见', value: '金额不对' },
        ],
        title: '拒绝「胡永静提交的付款审批单」',
        warnings: ['拒绝后该审批单将结束。'],
      },
    );
    expect(card.title).toBe('拒绝「胡永静提交的付款审批单」');
    expect(card.content).toBe(
      [
        '⚠️ 高风险操作',
        '审批单：胡永静提交的付款审批单',
        '结果：拒绝',
        '意见：金额不对',
        '⚠️ 拒绝后该审批单将结束。',
      ].join('\n'),
    );
    expect(card.content).not.toContain('99887766');
    expect(card.content).not.toContain('proc-inst-999');
  });

  it('appends the full saveTemplate field block when the preview only names controls', () => {
    const card = formatDingTalkPreviewCard(
      {
        apiName: 'saveTemplate',
        args: {
          description: '给项目结案用',
          fields: [
            {
              componentType: 'DDSelectField',
              defaultValue: '通过',
              label: '结果',
              options: ['通过', { label: '驳回', value: 'reject' }],
              required: true,
            },
            {
              children: [{ componentType: 'TextField', label: '明细', required: false }],
              componentType: 'TableField',
              label: '明细表',
            },
          ],
          name: '项目结案申请',
          processCode: 'PROC-9',
        },
      },
      {
        danger: false,
        lines: [
          { label: '模板名称', value: '项目结案申请' },
          { label: '操作', value: '创建' },
          { label: '控件', value: '结果、明细表' },
        ],
        title: '创建模板「项目结案申请」',
        warnings: ['请到钉钉后台设置流程。'],
      },
    );
    expect(card.title).toBe('创建模板「项目结案申请」');
    expect(card.content).toContain('模板名称：项目结案申请');
    expect(card.content).toContain('控件：结果、明细表');
    expect(card.content).toContain('- 结果（DDSelectField，必填）');
    expect(card.content).toContain('选项：通过、驳回（reject）');
    expect(card.content).toContain('默认：通过');
    expect(card.content).toContain('- 明细（TextField，选填）');
    expect(card.content).toContain('说明：给项目结案用');
    expect(card.content).toContain('⚠️ 请到钉钉后台设置流程。');
    expect(card.content).not.toContain('PROC-9');
  });
});

describe('formatDingTalkPreviewUnavailable', () => {
  it('names the error code and the topic link', () => {
    const link = buildDingTalkTopicDeepLink('agt_1', 'topic_1');
    expect(formatDingTalkPreviewUnavailable('DINGTALK_NOT_FOUND', link)).toBe(
      `无法解析操作对象（DINGTALK_NOT_FOUND），请到网页端确认：${link}`,
    );
    expect(formatDingTalkPreviewUnavailable('  ', '')).toBe(
      '无法解析操作对象（UNKNOWN），请到网页端确认：当前话题',
    );
  });
});

describe('formatDingTalkCardSendFailedContent', () => {
  it('tells the model to confirm on the web topic', () => {
    const link = buildDingTalkTopicDeepLink('agt_1', 'topic_1');
    const text = formatDingTalkCardSendFailedContent(link);
    expect(text).toBe(`该操作需要本人确认，钉钉内确认卡片发送失败；请到网页端 ${link} 确认`);
    expect(link).toBe(
      'https://chat.example.com/dingtalk/sso?redirect=' +
        encodeURIComponent('/agent/agt_1/topic_1'),
    );
    expect(text).not.toContain('Blocked by security/privacy');
  });
});
