import { describe, expect, it } from 'vitest';

import {
  projectGroups,
  projectMessages,
  projectReportDetail,
  projectReports,
  projectTemplate,
  projectTemplates,
  projectTodoDetail,
  projectTodoList,
} from './projection';

/** Shapes copied from the sanitized dws samples (fake names and ids only). */
const todoList = {
  data: {
    count: 2,
    hasMore: false,
    page: 1,
    size: 20,
    todos: [
      {
        dueTime: 1790326800000,
        finalStatusStage: 0,
        priority: 20,
        subject: '测试待办 123',
        taskId: '57475254077',
      },
      {
        dueTime: null,
        finalStatusStage: 0,
        priority: 20,
        subject: '整理周报',
        taskId: '49401323741',
      },
    ],
  },
  ok: true,
  outcome: 'success',
};

const todoGet = {
  data: {
    createdTime: 1790178236600,
    creatorInfo: { name: '张三', userId: 670023327 },
    detailUrl: {
      appUrl: 'https://n.dingtalk.com/todo/app/57475254077',
      pcUrl: 'https://n.dingtalk.com/todo/pc/57475254077',
    },
    dueTime: 1790326800000,
    executorInfos: [{ name: '张三', userId: 670023327 }],
    isDone: false,
    participantInfos: [{ name: '李四', userId: 1 }],
    priority: 20,
    subject: '测试待办 123',
    taskId: '57475254077',
  },
  ok: true,
};

const groupSearch = {
  result: {
    groups: [
      {
        groupType: 'INTERNAL_GROUP',
        memberCount: 7,
        openConversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
        title: '示例每日库存',
      },
    ],
    hasMore: false,
  },
  success: true,
};

const myGroups = {
  complete: false,
  count: 1,
  groups: [
    {
      conversationId: 'cidHSiwFH0otmmKBx7S9CtDwA==',
      memberCount: 24,
      name: '工作通知:示例科技有限公司',
      type: 'UNKNOWN_TYPE',
    },
  ],
  hasMore: true,
  nextCursor: 1570867670963,
};

const messages = {
  count: 1,
  hasMore: false,
  messages: [
    {
      conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
      createTime: '2026-09-22 09:30:31',
      messageId: 'msg1QZt/yXx+WAVUM4WxKzAzg==',
      resourceRefs: [
        {
          name: '2026年9月库存日报表.xlsx',
          resourceId: 'pGBa2Lm8aGX7ebA1szppBbEKVgN7R35y',
          resourceIdType: 'fileId',
          type: 'fileId',
        },
      ],
      sender: '李四',
      senderId: 'DTt6iiGAaymdUiScDYMmyMPgg21oEEM2YhB',
      text: '[文件] 2026年9月库存日报表.xlsx',
    },
  ],
  queryRange: {
    endTime: '2026-09-24T12:00:00+08:00',
    startTime: '2026-09-22T00:00:00+08:00',
  },
  truncated: false,
};

const inbox = {
  data: {
    complete: true,
    count: 1,
    reports: [
      {
        createTime: 1780664662000,
        creatorUserId: '098765432109876543',
        modifiedTime: 1780664662000,
        reportId: '19e97e277329624c7bcc27749e587819',
        templateName: '月报',
      },
    ],
  },
  ok: true,
};

const reportGet = {
  result: {
    createTime: 1780664662000,
    creatorName: '王五',
    deptName: '一车间',
    report_Id: '19e97e277329624c7bcc27749e587819',
    report_content: [
      { key: '上月遗留工作及未完成原因', sort: 4, type: 1, value: '无\n' },
      { key: '下月工作计划', sort: 2, type: 1, value: '' },
    ],
    report_name: '王五的月报',
    report_template_name: '月报',
    template_id: '16c60a882afe4b4544d192f4d618ab7a',
    url: 'dingtalk://dingtalkclient/page/report',
  },
  success: true,
};

const templates = {
  items: [
    {
      report_template_id: '1887f1535bb7e4553f1d3674976a5321',
      report_template_name: '销售战报',
    },
  ],
  success: true,
};

const templateGet = {
  result: {
    report_template_fields: [
      { field_name: '今日完成工作', field_sort: 0, field_type: 1 },
      { field_name: '未完成工作', field_sort: 1, field_type: 1 },
    ],
    report_template_id: '16c60a883117546fb832c804ecd9de5f',
    report_template_name: '日报',
  },
  success: true,
};

describe('dingtalk personal projections', () => {
  it('projects an enveloped todo list and keeps null due times', () => {
    expect(projectTodoList(todoList, { page: 1, status: 'open' })).toEqual({
      hasMore: false,
      kind: 'todos',
      page: 1,
      status: 'open',
      todos: [
        {
          dueTime: 1790326800000,
          priority: 20,
          stage: 0,
          subject: '测试待办 123',
          taskId: '57475254077',
        },
        {
          dueTime: null,
          priority: 20,
          stage: 0,
          subject: '整理周报',
          taskId: '49401323741',
        },
      ],
    });
  });

  it('accepts an already-unwrapped todo list', () => {
    const state = projectTodoList(todoList.data, { page: 2, status: 'all' });
    expect(state.page).toBe(2);
    expect(state.status).toBe('all');
    expect(state.todos).toHaveLength(2);
  });

  it('projects todo detail names and prefers the pc url', () => {
    expect(projectTodoDetail(todoGet).todo).toEqual({
      createdTime: 1790178236600,
      creatorName: '张三',
      detailUrl: 'https://n.dingtalk.com/todo/pc/57475254077',
      dueTime: 1790326800000,
      executorNames: ['张三'],
      isDone: false,
      participantNames: ['李四'],
      priority: 20,
      subject: '测试待办 123',
      taskId: '57475254077',
    });
  });

  it('projects group search (openConversationId/title) and my-groups (numeric cursor)', () => {
    expect(projectGroups(groupSearch)).toEqual({
      groups: [
        {
          conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
          memberCount: 7,
          name: '示例每日库存',
          type: 'INTERNAL_GROUP',
        },
      ],
      hasMore: false,
      kind: 'groups',
    });
    expect(projectGroups(myGroups)).toEqual({
      groups: [
        {
          conversationId: 'cidHSiwFH0otmmKBx7S9CtDwA==',
          memberCount: 24,
          name: '工作通知:示例科技有限公司',
          type: 'UNKNOWN_TYPE',
        },
      ],
      hasMore: true,
      kind: 'groups',
      nextCursor: '1570867670963',
    });
  });

  it('keeps message createTime as the dws string and maps file refs', () => {
    const state = projectMessages(messages, {
      conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
      endTime: '2026-09-24T12:00:00+08:00',
      startTime: '2026-09-22T00:00:00+08:00',
    });
    expect(state).toMatchObject({
      conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
      count: 1,
      hasMore: false,
      kind: 'messages',
      truncated: false,
    });
    expect(state.messages[0]).toEqual({
      createTime: '2026-09-22 09:30:31',
      files: [
        {
          name: '2026年9月库存日报表.xlsx',
          resourceId: 'pGBa2Lm8aGX7ebA1szppBbEKVgN7R35y',
          resourceType: 'fileId',
        },
      ],
      messageId: 'msg1QZt/yXx+WAVUM4WxKzAzg==',
      sender: '李四',
      senderId: 'DTt6iiGAaymdUiScDYMmyMPgg21oEEM2YhB',
      text: '[文件] 2026年9月库存日报表.xlsx',
    });
  });

  it('marks search messages hasMore without inventing a cursor field', () => {
    const state = projectMessages({ ...messages, hasMore: true, nextCursor: 'opaque-cursor' });
    expect(state.hasMore).toBe(true);
    expect(state).not.toHaveProperty('nextCursor');
  });

  it('projects inbox reports and leaves nextCursor off when the page is complete', () => {
    expect(projectReports(inbox, 'inbox', 0)).toEqual({
      box: 'inbox',
      complete: true,
      kind: 'reports',
      reports: [
        {
          createTime: 1780664662000,
          creatorUserId: '098765432109876543',
          modifiedTime: 1780664662000,
          reportId: '19e97e277329624c7bcc27749e587819',
          templateName: '月报',
        },
      ],
    });
  });

  it('computes the next report offset when the page is not complete', () => {
    const state = projectReports(
      { data: { complete: false, reports: [{ reportId: 'r1' }, { reportId: 'r2' }] } },
      'outbox',
      20,
    );
    expect(state.nextCursor).toBe(22);
    expect(state.complete).toBe(false);
  });

  it('projects report detail contents from report_content', () => {
    expect(projectReportDetail(reportGet).report).toEqual({
      contents: [
        { key: '上月遗留工作及未完成原因', value: '无\n' },
        { key: '下月工作计划', value: '' },
      ],
      createTime: 1780664662000,
      creatorName: '王五',
      deptName: '一车间',
      name: '王五的月报',
      reportId: '19e97e277329624c7bcc27749e587819',
      templateName: '月报',
      url: 'dingtalk://dingtalkclient/page/report',
    });
  });

  it('projects template list and template fields', () => {
    expect(projectTemplates(templates)).toEqual({
      kind: 'templates',
      templates: [{ id: '1887f1535bb7e4553f1d3674976a5321', name: '销售战报' }],
    });
    expect(projectTemplate(templateGet).template).toEqual({
      fields: [
        { name: '今日完成工作', sort: 0, type: 1 },
        { name: '未完成工作', sort: 1, type: 1 },
      ],
      id: '16c60a883117546fb832c804ecd9de5f',
      name: '日报',
    });
  });

  it('does not throw when payloads and fields are missing', () => {
    expect(projectTodoList(undefined, { page: 1, status: 'done' })).toEqual({
      hasMore: false,
      kind: 'todos',
      page: 1,
      status: 'done',
      todos: [],
    });
    expect(projectTodoDetail(null).todo.executorNames).toEqual([]);
    expect(projectTodoDetail({ data: {} }).todo.participantNames).toEqual([]);
    expect(projectGroups({}).groups).toEqual([]);
    expect(
      projectMessages({ messages: [{}, { resourceRefs: [{ name: 'orphan' }] }] }).messages,
    ).toEqual([]);
    expect(projectReports({}, 'inbox').reports).toEqual([]);
    expect(
      projectReportDetail({ result: { report_content: [{ value: null }] } }).report.contents,
    ).toEqual([]);
    expect(projectTemplates(null).templates).toEqual([]);
    expect(projectTemplate({}).template).toEqual({ fields: [], id: '', name: '' });
  });
});
