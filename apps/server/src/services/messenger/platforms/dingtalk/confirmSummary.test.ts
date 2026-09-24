import { describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://chat.example.com' },
}));

const {
  buildDingTalkTopicDeepLink,
  dingTalkInvalidPreviewDetail,
  formatDingTalkAggregateBody,
  formatDingTalkAggregateTitle,
  formatDingTalkCardSendFailedContent,
  formatDingTalkConfirmSummary,
  formatDingTalkCountTitle,
  formatDingTalkOversizedBatch,
  formatDingTalkPreviewCard,
  formatDingTalkPreviewUnavailable,
  sanitizeDingTalkPreviewDetail,
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
    expect(
      formatDingTalkPreviewUnavailable(
        'DINGTALK_PERSONAL_INVALID_ARGS',
        link,
        '内容过大（约 80 KB），请分成多次写入',
      ),
    ).toBe(`内容过大（约 80 KB），请分成多次写入，请到网页端确认：${link}`);
  });
});

describe('dingTalkInvalidPreviewDetail', () => {
  it('strips the invalid-args prefix and caps the message at 150 characters', () => {
    const long = `字段「金额」不在该数据表中${'啊'.repeat(200)}`;
    expect(
      sanitizeDingTalkPreviewDetail(`参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：${long}`),
    ).toBe(long.slice(0, 150));
    expect(sanitizeDingTalkPreviewDetail('参数无效（DINGTALK_INVALID）：无法确认文档标题')).toBe(
      '无法确认文档标题',
    );
    expect(sanitizeDingTalkPreviewDetail('  参数无效（VALIDATION）：审批任务不能重复。  ')).toBe(
      '审批任务不能重复。',
    );
    expect(
      sanitizeDingTalkPreviewDetail('参数无效（DINGTALK_INVALID）：token=abc'),
    ).toBeUndefined();
  });

  it('keeps details.message only for an invalid-args code', () => {
    const error = {
      code: 'DINGTALK_PERSONAL_INVALID_ARGS',
      details: {
        message: '参数无效（DINGTALK_PERSONAL_INVALID_ARGS）：内容过大（约 80 KB），请分成多次写入',
      },
    };
    expect(dingTalkInvalidPreviewDetail(error, 'DINGTALK_PERSONAL_INVALID_ARGS')).toBe(
      '内容过大（约 80 KB），请分成多次写入',
    );
    expect(dingTalkInvalidPreviewDetail(error, 'DINGTALK_NOT_FOUND')).toBeUndefined();
    expect(
      dingTalkInvalidPreviewDetail(
        { code: 'DINGTALK_INVALID', details: { message: '字段「状态」不在该数据表中' } },
        'DINGTALK_INVALID',
      ),
    ).toBe('字段「状态」不在该数据表中');
    expect(
      dingTalkInvalidPreviewDetail(
        { code: 'VALIDATION', details: { message: '无法确认文档标题，不能发起确认' } },
        'VALIDATION',
      ),
    ).toBe('无法确认文档标题，不能发起确认');
  });
});

describe('formatDingTalkCardSendFailedContent', () => {
  it('tells the model to confirm on the web topic', () => {
    const link = buildDingTalkTopicDeepLink('agt_1', 'topic_1');
    const text = formatDingTalkCardSendFailedContent(link);
    expect(text).toBe(`该操作需要本人确认，钉钉内确认卡片发送失败；请到[网页端](${link})确认`);
    expect(text).not.toMatch(/\]\(<http/);
    expect(link).toBe(
      'https://chat.example.com/dingtalk/sso?redirect=' +
        encodeURIComponent('/agent/agt_1/topic_1'),
    );
    expect(text).not.toContain('Blocked by security/privacy');
  });
});

describe('DingTalk confirm labels', () => {
  it('uses Chinese labels and never the raw api name', () => {
    expect(formatDingTalkConfirmSummary({ apiName: 'submitReport', args: {} }).title).toBe(
      '提交日志',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'completeTodos', args: {} }).title).toBe(
      '批量完成待办',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'deleteTodos', args: {} }).title).toBe(
      '批量删除待办',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'appendDoc', args: {} }).title).toBe(
      '追加文档内容',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'createDoc', args: {} }).title).toBe('新建文档');
    expect(formatDingTalkConfirmSummary({ apiName: 'appendSheetRows', args: {} }).title).toBe(
      '向表格追加行',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'createAitableRecords', args: {} }).title).toBe(
      '新增 AI 表格记录',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'updateAitableRecords', args: {} }).title).toBe(
      '修改 AI 表格记录',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'approveTasks', args: {} }).title).toBe(
      '批量同意审批',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'refuseTasks', args: {} }).title).toBe(
      '批量拒绝审批',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'installPlugin', args: {} }).title).toBe(
      '安装技能',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'showAgentMarketplace', args: {} }).title).toBe(
      '打开助手市场',
    );
    expect(formatDingTalkConfirmSummary({ apiName: 'saveUserQuestion', args: {} }).title).toBe(
      '保存助手设置',
    );

    const unknown = formatDingTalkConfirmSummary({
      apiName: 'customTool',
      args: { name: '甲' },
    });
    expect(unknown.title).toBe('确认操作');
    expect(unknown.content).not.toContain('customTool');
    expect(unknown.content).toContain('甲');

    const titled = formatDingTalkConfirmSummary({
      apiName: 'customTool',
      args: {},
      manifestTitle: '群组助手',
    });
    expect(titled.title).toBe('执行「群组助手」操作');
    expect(titled.content).not.toContain('customTool');
  });

  it('builds a count title for the same api and a mixed title otherwise', () => {
    expect(formatDingTalkCountTitle('completeTodo', 3)).toBe('完成 3 项待办');
    expect(formatDingTalkCountTitle('completeTodos', 3)).toBe('完成 3 项待办');
    expect(formatDingTalkCountTitle('deleteTodos', 2)).toBe('删除 2 项待办');
    expect(formatDingTalkCountTitle('approveTasks', 4)).toBe('同意 4 项审批');
    expect(formatDingTalkCountTitle('refuseTasks', 2)).toBe('拒绝 2 项审批');
    expect(formatDingTalkCountTitle('appendDoc', 2)).toBe('追加 2 项文档内容');
    expect(formatDingTalkCountTitle('createDoc', 2)).toBe('新建 2 项文档');
    expect(formatDingTalkCountTitle('appendSheetRows', 15)).toBe('追加 15 行表格数据');
    expect(formatDingTalkCountTitle('createAitableRecords', 8)).toBe('新增 8 条 AI 表格记录');
    expect(formatDingTalkCountTitle('updateAitableRecords', 3)).toBe('修改 3 条 AI 表格记录');
    expect(formatDingTalkAggregateTitle([{ apiName: 'completeTodo' }], '完成待办「甲」')).toBe(
      '完成待办「甲」',
    );
    expect(
      formatDingTalkAggregateTitle(
        [{ apiName: 'completeTodo' }, { apiName: 'completeTodo' }, { apiName: 'completeTodo' }],
        'x',
      ),
    ).toBe('完成 3 项待办');
    expect(
      formatDingTalkAggregateTitle([{ apiName: 'completeTodo' }, { apiName: 'deleteTodo' }], 'x'),
    ).toBe('确认 2 项操作');
    expect(
      formatDingTalkAggregateTitle([{ apiName: 'customTool' }, { apiName: 'customTool' }], 'x'),
    ).toBe('确认 2 项操作');
    expect(
      formatDingTalkAggregateTitle(
        [
          { apiName: 'completeTodos', args: { taskIds: ['a', 'b', 'c'] } },
          { apiName: 'completeTodos', args: { taskIds: ['d', 'e'] } },
        ],
        'x',
      ),
    ).toBe('完成 5 项待办');
    expect(
      formatDingTalkAggregateTitle(
        [
          { apiName: 'approveTasks', args: { tasks: [{ taskId: '1' }, { taskId: '2' }] } },
          { apiName: 'approveTasks', args: { tasks: [{ taskId: '3' }] } },
        ],
        'x',
      ),
    ).toBe('同意 3 项审批');
    expect(
      formatDingTalkAggregateTitle([{ apiName: 'appendDoc' }, { apiName: 'appendDoc' }], 'x'),
    ).toBe('追加 2 项文档内容');
    expect(
      formatDingTalkAggregateTitle(
        [
          { apiName: 'appendSheetRows', args: { rows: Array.from({ length: 10 }, () => []) } },
          { apiName: 'appendSheetRows', args: { rows: Array.from({ length: 5 }, () => []) } },
        ],
        'x',
      ),
    ).toBe('追加 15 行表格数据');
    expect(
      formatDingTalkAggregateTitle(
        [
          { apiName: 'createAitableRecords', args: { records: [{}, {}] } },
          { apiName: 'createAitableRecords', args: { records: [{}, {}, {}, {}, {}, {}] } },
        ],
        'x',
      ),
    ).toBe('新增 8 条 AI 表格记录');
    expect(
      formatDingTalkAggregateTitle(
        [
          { apiName: 'updateAitableRecords', args: { records: [{}] } },
          { apiName: 'updateAitableRecords', args: { records: [{}, {}] } },
        ],
        'x',
      ),
    ).toBe('修改 3 条 AI 表格记录');
  });

  it('lists every preview line and warning under each number', () => {
    const body = formatDingTalkAggregateBody([
      {
        content: ['⚠️ 高风险操作', '审批单：付款', '⚠️ 拒绝后该审批单将结束。'].join('\n'),
        title: '拒绝「付款」',
      },
      {
        content: ['待办：甲', '⚠️ 完成后该待办会标记为已完成。'].join('\n'),
        title: '完成待办',
      },
    ]);
    expect(body).toBe(
      [
        '1. 拒绝「付款」 — ⚠️ 高风险操作',
        '   审批单：付款',
        '   ⚠️ 拒绝后该审批单将结束。',
        '2. 完成待办 — 待办：甲',
        '   ⚠️ 完成后该待办会标记为已完成。',
      ].join('\n'),
    );
  });

  it('describes an oversized turn without an api name', () => {
    const names = Array.from({ length: 21 }, () => ({ apiName: 'completeTodo' }));
    const card = formatDingTalkOversizedBatch(names, 'https://chat.example.com/t');
    expect(card.allowApprove).toBe(false);
    expect(card.title).toBe('完成 21 项待办');
    expect(card.content).toBe('共 21 项操作，请到网页端确认。');
    expect(card.note).toContain('内容较长，完整内容请在网页端确认：');
    expect(card.content).not.toContain('completeTodo');
  });
});
