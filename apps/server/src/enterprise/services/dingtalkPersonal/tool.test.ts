import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DingtalkPersonalService } from '@/server/enterprise/services/dingtalkPersonal';

import type { DingtalkPersonalApiName } from './tool';
import {
  dingtalkPersonalWebAuthorizeUrl,
  previewDingtalkPersonalWrite,
  runDingtalkPersonalTool,
} from './tool';

const mocks = vi.hoisted(() => {
  class DingtalkPersonalError extends Error {
    code: string;
    details?: Record<string, unknown>;
    constructor(code: string, details?: Record<string, unknown>) {
      super(code);
      this.name = 'DingtalkPersonalError';
      this.code = code;
      this.details = details;
    }
  }
  return {
    appEnv: { APP_URL: 'https://aihub.example.com/' },
    audit: vi.fn(),
    DingtalkPersonalError,
    downloadFile: vi.fn(),
    exec: vi.fn(),
    getStaffId: vi.fn(),
    ingest: vi.fn(),
    sendCard: vi.fn(),
    startLogin: vi.fn(),
  };
});

vi.mock('@/envs/app', () => ({
  appEnv: mocks.appEnv,
}));

vi.mock('@/server/enterprise/services/dingtalkPersonal', () => ({
  appendDingtalkPersonalAudit: mocks.audit,
  DingtalkPersonalError: mocks.DingtalkPersonalError,
  DingtalkPersonalService: vi.fn(function Service() {
    return {
      downloadFile: mocks.downloadFile,
      exec: mocks.exec,
      getStaffId: mocks.getStaffId,
      startLogin: mocks.startLogin,
    };
  }),
}));

vi.mock('@/server/services/messenger/platforms/dingtalk/personalAuthCard', () => ({
  sendDingtalkPersonalAuthCard: mocks.sendCard,
}));

vi.mock('./fileIngest', () => ({
  ingestDingtalkPersonalFile: mocks.ingest,
}));

const db = { tag: 'db' };
const { DingtalkPersonalError } = mocks;

const run = (
  apiName: DingtalkPersonalApiName,
  args: Record<string, unknown>,
  ctx: { botPlatform?: string; botThreadId?: string; workspaceId?: string } = {},
) => runDingtalkPersonalTool(db as never, 'user-1', apiName, args, ctx);

const DAY = 24 * 60 * 60 * 1000;
const start = '2026-09-01T00:00:00.000Z';
const isoAfter = (days: number, extraMs = 0) =>
  new Date(Date.parse(start) + days * DAY + extraMs).toISOString();

const TODO_LIST = {
  data: {
    hasMore: false,
    todos: [
      {
        dueTime: 1790326800000,
        finalStatusStage: 0,
        priority: 20,
        subject: '测试待办 123',
        taskId: '57475254077',
      },
    ],
  },
  ok: true,
};

const TODO_GET = {
  data: {
    creatorInfo: { name: '张三' },
    detailUrl: { pcUrl: 'https://n.dingtalk.com/todo/pc/57475254077' },
    dueTime: 1790326800000,
    executorInfos: [{ name: '张三' }],
    isDone: false,
    participantInfos: [],
    priority: 20,
    subject: '测试待办 123',
    taskId: '57475254077',
  },
  ok: true,
};

const TEMPLATE = {
  result: {
    report_template_fields: [
      { field_name: '今日完成工作', field_sort: 0, field_type: 1 },
      { field_name: '未完成工作', field_sort: 1, field_type: 1 },
    ],
    report_template_id: 'tpl-1',
    report_template_name: '日报',
  },
  success: true,
};

const LOGIN = {
  expiresAt: '2026-09-24T12:15:00.000Z',
  jobId: 'job-1',
  status: 'pending',
  userCode: 'JCHB-KBXF',
  verificationUrl: 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=JCHB-KBXF',
};

const WEB_AUTH_URL = 'https://aihub.example.com/settings/connector?dingtalkPersonal=authorize';
const WEB_AUTH_LINK = `[点此前往授权](${WEB_AUTH_URL})`;
const DINGTALK_AUTH_LINK = `[点此授权钉钉个人数据](${LOGIN.verificationUrl})`;
const DINGTALK_APP_AUTH_URL = `https://aihub.example.com/dingtalk/sso?redirect=${encodeURIComponent('/settings/connector?dingtalkPersonal=authorize')}`;
const DINGTALK_APP_AUTH_LINK = `[点此授权钉钉个人数据](${DINGTALK_APP_AUTH_URL})`;

describe('dingtalkPersonalWebAuthorizeUrl', () => {
  it('joins APP_URL without a trailing slash and falls back to a relative path', () => {
    expect(dingtalkPersonalWebAuthorizeUrl('https://aihub.example.com/')).toBe(WEB_AUTH_URL);
    expect(dingtalkPersonalWebAuthorizeUrl('https://aihub.example.com')).toBe(WEB_AUTH_URL);
    expect(dingtalkPersonalWebAuthorizeUrl('')).toBe(
      '/settings/connector?dingtalkPersonal=authorize',
    );
    expect(dingtalkPersonalWebAuthorizeUrl('   ')).toBe(
      '/settings/connector?dingtalkPersonal=authorize',
    );
    expect(dingtalkPersonalWebAuthorizeUrl(undefined)).toBe(
      '/settings/connector?dingtalkPersonal=authorize',
    );
  });
});

describe('runDingtalkPersonalTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appEnv.APP_URL = 'https://aihub.example.com/';
    mocks.exec.mockReset();
    mocks.downloadFile.mockReset();
    mocks.getStaffId.mockReset();
    mocks.startLogin.mockReset();
    mocks.audit.mockReset();
    mocks.sendCard.mockReset();
    mocks.ingest.mockReset();
    mocks.audit.mockResolvedValue(undefined);
  });

  it('listMyTodos asks for every role and projects the list', async () => {
    mocks.exec.mockResolvedValueOnce(TODO_LIST);
    const result = await run('listMyTodos', {});
    expect(mocks.exec).toHaveBeenCalledWith('todo.list', {
      page: 1,
      roleTypes: ['creator', 'executor', 'participant'],
      status: 'open',
    });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      kind: 'todos',
      page: 1,
      status: 'open',
      todos: [expect.objectContaining({ subject: '测试待办 123', taskId: '57475254077' })],
    });
    expect(JSON.parse(result.content)).toEqual(result.state);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(DingtalkPersonalService).toHaveBeenCalledWith(db, 'user-1');
  });

  it('getTodo / searchGroups / listMyGroups / messages / search / reports / templates', async () => {
    mocks.exec.mockResolvedValueOnce(TODO_GET);
    const todo = await run('getTodo', { taskId: '57475254077' });
    expect(mocks.exec).toHaveBeenCalledWith('todo.get', { taskId: '57475254077' });
    expect(todo.state).toMatchObject({ kind: 'todo', todo: { creatorName: '张三' } });

    mocks.exec.mockResolvedValueOnce({
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
    });
    const groups = await run('searchGroups', { query: '库存' });
    expect(mocks.exec).toHaveBeenCalledWith('chat.searchGroups', { query: '库存' });
    expect(groups.state).toMatchObject({
      groups: [{ name: '示例每日库存' }],
      kind: 'groups',
    });

    mocks.exec.mockResolvedValueOnce({
      groups: [
        { conversationId: 'cidHSiw==', memberCount: 2, name: 'IT维护', type: 'INTERNAL_GROUP' },
      ],
      hasMore: true,
      nextCursor: 1570867670963,
    });
    const mine = await run('listMyGroups', { cursor: '1570867670963' });
    expect(mocks.exec).toHaveBeenCalledWith('chat.myGroups', { cursor: '1570867670963' });
    expect(mine.state).toMatchObject({
      hasMore: true,
      kind: 'groups',
      nextCursor: '1570867670963',
    });

    const end = isoAfter(7);
    mocks.exec.mockResolvedValueOnce({
      hasMore: false,
      messages: [
        {
          createTime: '2026-09-22 09:30:31',
          messageId: 'msg1',
          resourceRefs: [{ name: '库存.xlsx', resourceId: 'file-1', resourceIdType: 'fileId' }],
          sender: '李四',
          text: '[文件] 库存.xlsx',
        },
      ],
      truncated: false,
    });
    const messages = await run('listGroupMessages', {
      conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
      endTime: end,
      maxMessages: 500,
      startTime: start,
    });
    expect(mocks.exec).toHaveBeenCalledWith('chat.messages', {
      conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
      end,
      maxItems: 500,
      start,
    });
    expect(messages.state).toMatchObject({
      count: 1,
      kind: 'messages',
      messages: [{ files: [{ resourceId: 'file-1', resourceType: 'fileId' }], sender: '李四' }],
    });

    mocks.exec.mockResolvedValueOnce({ hasMore: true, messages: [], truncated: false });
    const found = await run('searchMessages', {
      conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
      query: '库存',
    });
    expect(mocks.exec).toHaveBeenCalledWith('chat.searchMessages', {
      conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
      query: '库存',
    });
    expect(found.state).toMatchObject({ hasMore: true, kind: 'messages' });

    mocks.exec.mockResolvedValueOnce({
      data: { complete: true, reports: [{ reportId: 'rpt-1', templateName: '月报' }] },
      ok: true,
    });
    const inbox = await run('listReports', {
      box: 'inbox',
      endTime: isoAfter(180),
      startTime: start,
    });
    expect(mocks.exec).toHaveBeenCalledWith('report.inbox', { end: isoAfter(180), start });
    expect(inbox.state).toMatchObject({
      box: 'inbox',
      kind: 'reports',
      reports: [{ reportId: 'rpt-1' }],
    });

    mocks.exec.mockResolvedValueOnce({
      data: { complete: true, reports: [] },
      ok: true,
    });
    const outbox = await run('listReports', {
      box: 'outbox',
      cursor: 0,
      endTime: isoAfter(20),
      startTime: start,
    });
    expect(mocks.exec).toHaveBeenCalledWith('report.outbox', {
      cursor: 0,
      end: isoAfter(20),
      start,
    });
    expect(outbox.state).toMatchObject({ box: 'outbox', complete: true, reports: [] });

    mocks.exec.mockResolvedValueOnce({
      result: {
        creatorName: '王五',
        report_Id: 'rpt-1',
        report_content: [{ key: '本月工作内容', value: '巡检' }],
        report_name: '王五的月报',
      },
      success: true,
    });
    const report = await run('getReport', { reportId: 'rpt-1' });
    expect(mocks.exec).toHaveBeenCalledWith('report.get', { reportId: 'rpt-1' });
    expect(report.state).toMatchObject({
      kind: 'report',
      report: { creatorName: '王五', name: '王五的月报' },
    });

    mocks.exec.mockResolvedValueOnce({
      items: [{ report_template_id: 'tpl-1', report_template_name: '日报' }],
      success: true,
    });
    const templates = await run('listReportTemplates', {});
    expect(mocks.exec).toHaveBeenCalledWith('report.templates', {});
    expect(templates.state).toMatchObject({
      kind: 'templates',
      templates: [{ id: 'tpl-1', name: '日报' }],
    });

    mocks.exec.mockResolvedValueOnce(TEMPLATE);
    const template = await run('getReportTemplate', { name: '日报' });
    expect(mocks.exec).toHaveBeenCalledWith('report.template', { name: '日报' });
    expect(template.state).toMatchObject({
      kind: 'template',
      template: {
        id: 'tpl-1',
        name: '日报',
        fields: expect.arrayContaining([expect.objectContaining({ name: '今日完成工作' })]),
      },
    });
  });

  it('downloadMessageFile returns parsed text above the 30 000 model cap and a short preview', async () => {
    const text = '表'.repeat(40_000);
    mocks.downloadFile.mockResolvedValueOnce({
      buffer: Buffer.from('xlsx'),
      name: 'files/2026年9月库存日报表.xlsx',
      sizeBytes: 91371,
    });
    mocks.ingest.mockResolvedValueOnce({
      fileId: 'file-1',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: '2026年9月库存日报表.xlsx',
      parseFailed: false,
      parseable: true,
      sizeBytes: 91371,
      text,
      url: 'https://files.example/file-1',
    });
    const result = await run(
      'downloadMessageFile',
      {
        conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
        messageId: 'msg1',
        resourceId: 'pGBa2Lm8aGX7ebA1szppBbEKVgN7R35y',
        resourceType: 'fileId',
      },
      { workspaceId: 'ws-1' },
    );
    expect(mocks.downloadFile).toHaveBeenCalledWith({
      conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
      messageId: 'msg1',
      resourceId: 'pGBa2Lm8aGX7ebA1szppBbEKVgN7R35y',
      resourceType: 'fileId',
    });
    expect(mocks.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'files/2026年9月库存日报表.xlsx',
        userId: 'user-1',
        workspaceId: 'ws-1',
      }),
    );
    expect(result.success).toBe(true);
    expect(
      result.content.startsWith(
        '已下载群文件「2026年9月库存日报表.xlsx」（89 KB），以下是文件内容：',
      ),
    ).toBe(true);
    expect(result.content).toContain(text);
    expect(result.content.length).toBeGreaterThan(30_000);
    expect(result.state).toMatchObject({
      fileId: 'file-1',
      kind: 'file',
      name: '2026年9月库存日报表.xlsx',
      preview: text.slice(0, 2000),
      sizeBytes: 91371,
      url: 'https://files.example/file-1',
    });
  });

  it('caps downloaded text at 200 000 characters and explains unreadable files', async () => {
    const text = `${'A'.repeat(200_000)}ENDMARKER`;
    mocks.downloadFile.mockResolvedValue({
      buffer: Buffer.from('x'),
      name: '大表.xlsx',
      sizeBytes: 20,
    });
    mocks.ingest.mockResolvedValueOnce({
      fileId: 'file-2',
      name: '大表.xlsx',
      parseFailed: false,
      parseable: true,
      sizeBytes: 20,
      text,
      url: 'https://files.example/file-2',
    });
    const clipped = await run('downloadMessageFile', {
      resourceId: 'file-2',
      resourceType: 'fileId',
    });
    expect(clipped.content).not.toContain('ENDMARKER');
    expect(clipped.content).toContain('文件内容已截断');
    expect((clipped.state as { preview?: string }).preview).toHaveLength(2000);

    mocks.ingest.mockResolvedValueOnce({
      fileId: 'file-3',
      name: '现场.png',
      parseFailed: false,
      parseable: false,
      sizeBytes: 100,
      url: 'https://files.example/file-3',
    });
    const image = await run('downloadMessageFile', { resourceId: 'img', resourceType: 'mediaId' });
    expect(image.content).toContain('无法作为文本读取');
    expect((image.state as { fileId?: string; preview?: string }).preview).toBeUndefined();
    expect((image.state as { fileId?: string }).fileId).toBe('file-3');

    mocks.ingest.mockResolvedValueOnce({
      fileId: 'file-4',
      name: '坏了.pdf',
      parseFailed: true,
      parseable: true,
      sizeBytes: 100,
      url: 'https://files.example/file-4',
    });
    const failed = await run('downloadMessageFile', { resourceId: 'pdf', resourceType: 'fileId' });
    expect(failed.content).toContain('无法解析为文本');
  });

  it('trims oversized model JSON and sets truncated without shrinking the render state', async () => {
    const todos = Array.from({ length: 40 }, (_, index) => ({
      dueTime: null,
      priority: 20,
      subject: '待办'.repeat(800),
      taskId: `t${index}`,
    }));
    mocks.exec.mockResolvedValueOnce({ data: { hasMore: true, todos }, ok: true });
    const result = await run('listMyTodos', { page: 2, status: 'all' });
    expect((result.state as { todos: unknown[] }).todos).toHaveLength(40);
    expect(result.content.length).toBeLessThanOrEqual(30_000);
    const parsed = JSON.parse(result.content);
    expect(parsed.truncated).toBe(true);
    expect(parsed.todos.length).toBeLessThan(40);
  });

  it('rejects windows, message caps, priority, and unknown template fields', async () => {
    const conversationId = 'cidvO0I6uONXHnc51d6c8tnNA==';
    const tooWide = await run('listGroupMessages', {
      conversationId,
      endTime: isoAfter(7, 1),
      startTime: start,
    });
    expect(tooWide.success).toBe(false);
    expect(tooWide.error?.code).toBe('DINGTALK_PERSONAL_INVALID_ARGS');
    expect(tooWide.content).toContain('7 天');
    expect(tooWide.content).toContain('DINGTALK_PERSONAL_INVALID_ARGS');

    const tooMany = await run('listGroupMessages', {
      conversationId,
      endTime: isoAfter(1),
      maxMessages: 501,
      startTime: start,
    });
    expect(tooMany.content).toContain('500');

    const inbox = await run('listReports', {
      box: 'inbox',
      endTime: isoAfter(180, 1),
      startTime: start,
    });
    expect(inbox.content).toContain('180');
    const outbox = await run('listReports', {
      box: 'outbox',
      endTime: isoAfter(20, 1),
      startTime: start,
    });
    expect(outbox.content).toContain('20');

    const priority = await run('updateTodo', { priority: 15, taskId: '57475254077' });
    expect(priority.content).toContain('优先级');

    const emptyUpdate = await run('updateTodo', { taskId: '57475254077' });
    expect(emptyUpdate.content).toContain('至少');

    mocks.exec.mockResolvedValueOnce(TEMPLATE);
    const badField = await run('submitReport', {
      contents: [{ content: '写了方案', key: '不存在的字段' }],
      templateName: '日报',
      toUserIds: ['staff001'],
    });
    expect(badField.content).toContain('不存在的字段');
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    expect(mocks.exec).toHaveBeenCalledWith('report.template', { name: '日报' });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('allows a window that is exactly 7, 180, or 20 days', async () => {
    mocks.exec.mockResolvedValue({ hasMore: false, messages: [], truncated: false });
    const messages = await run('listGroupMessages', {
      conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
      endTime: isoAfter(7),
      startTime: start,
    });
    expect(messages.success).toBe(true);

    mocks.exec.mockResolvedValue({ data: { complete: true, reports: [] }, ok: true });
    expect(
      (await run('listReports', { box: 'inbox', endTime: isoAfter(180), startTime: start }))
        .success,
    ).toBe(true);
    expect(
      (await run('listReports', { box: 'outbox', endTime: isoAfter(20), startTime: start }))
        .success,
    ).toBe(true);
  });

  it('updateTodo, completeTodo, and submitReport audit only after success and omit bodies', async () => {
    mocks.exec.mockResolvedValueOnce({ data: { subject: '新标题', taskId: '57475254077' } });
    const updated = await run('updateTodo', {
      priority: 40,
      taskId: '57475254077',
      title: '新标题',
    });
    expect(updated.success).toBe(true);
    expect(updated.state).toMatchObject({
      action: 'updateTodo',
      kind: 'write',
      summary: '已更新待办「新标题」',
      taskId: '57475254077',
    });
    expect(mocks.exec).toHaveBeenCalledWith('todo.update', {
      priority: 40,
      taskId: '57475254077',
      title: '新标题',
    });
    expect(mocks.audit).toHaveBeenCalledWith(db, 'user-1', 'todo.update', {
      afterDiff: { priority: 40, subject: '新标题', title: '新标题' },
      result: 'success',
      targetId: '57475254077',
    });

    mocks.audit.mockClear();
    mocks.exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_UPSTREAM', { message: 'bad' }),
    );
    const failed = await run('completeTodo', { taskId: '57475254077' });
    expect(failed.success).toBe(false);
    expect(failed.content).toContain('DINGTALK_PERSONAL_UPSTREAM');
    expect(mocks.audit).not.toHaveBeenCalled();

    mocks.exec.mockResolvedValueOnce({});
    mocks.audit.mockRejectedValueOnce(new Error('audit down'));
    const completed = await run('completeTodo', { taskId: '57475254077' });
    expect(completed.success).toBe(true);
    expect(mocks.audit).toHaveBeenCalledWith(
      db,
      'user-1',
      'todo.complete',
      expect.objectContaining({ result: 'success', targetId: '57475254077' }),
    );

    mocks.audit.mockResolvedValueOnce(undefined);
    mocks.exec.mockImplementation(async (op: string) => {
      if (op === 'report.template') return TEMPLATE;
      if (op === 'report.submit') return { data: { reportId: 'rpt-9' } };
      throw new Error(op);
    });
    const submitted = await run('submitReport', {
      contents: [{ content: '写了方案\n换行', key: '今日完成工作' }],
      templateName: '日报',
      toUserIds: ['staff001'],
    });
    expect(submitted.success).toBe(true);
    expect(submitted.state).toMatchObject({
      action: 'submitReport',
      reportId: 'rpt-9',
      summary: '已提交日志「日报」',
    });
    expect(mocks.exec).toHaveBeenCalledWith('report.submit', {
      contents: [
        {
          content: '写了方案\n换行',
          contentType: 'markdown',
          key: '今日完成工作',
          sort: '0',
          type: '1',
        },
      ],
      templateId: 'tpl-1',
      toUserIds: ['staff001'],
    });
    const auditCall = mocks.audit.mock.calls.at(-1);
    expect(auditCall?.[2]).toBe('report.submit');
    expect(JSON.stringify(auditCall?.[3])).not.toContain('写了方案');
    expect(auditCall?.[3]).toMatchObject({
      afterDiff: { templateName: '日报' },
      result: 'success',
      targetId: 'rpt-9',
    });
  });

  it('on the web, unauthorized and expired do not start a login', async () => {
    for (const code of ['DINGTALK_PERSONAL_UNAUTHORIZED', 'DINGTALK_PERSONAL_EXPIRED'] as const) {
      mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError(code));
      const result = await run('listMyTodos', {}, { botPlatform: 'web' });
      expect(result.success).toBe(false);
      expect(result).not.toHaveProperty('error');
      expect(result.content).toContain('请点击下方卡片的「授权」按钮');
      expect(result.content).toContain(WEB_AUTH_LINK);
      expect(result.content).toContain('授权后再问我一次即可');
      expect(result.state).toEqual({
        authUrl: WEB_AUTH_URL,
        code,
        kind: 'authorizationRequired',
        settingsPath: '/settings/connector',
      });
    }
    expect(mocks.startLogin).not.toHaveBeenCalled();
    expect(mocks.sendCard).not.toHaveBeenCalled();
  });

  it('uses the same web link for other clients and a relative path when APP_URL is blank', async () => {
    mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_UNAUTHORIZED'));
    const other = await run('listMyTodos', {}, { botPlatform: 'wecom' });
    expect(other).not.toHaveProperty('error');
    expect(other.content).toContain(WEB_AUTH_LINK);
    expect((other.state as { authUrl?: string }).authUrl).toBe(WEB_AUTH_URL);

    mocks.appEnv.APP_URL = '';
    mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_EXPIRED'));
    const relative = await run('listMyTodos', {});
    expect(relative.content).toContain(
      '[点此前往授权](/settings/connector?dingtalkPersonal=authorize)',
    );
    expect(relative.state).toMatchObject({
      authUrl: '/settings/connector?dingtalkPersonal=authorize',
      code: 'DINGTALK_PERSONAL_EXPIRED',
    });
    expect(mocks.startLogin).not.toHaveBeenCalled();
  });

  it('on dingtalk, unauthorized sends one auth card and always includes the one-click link', async () => {
    mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_UNAUTHORIZED'));
    mocks.startLogin.mockResolvedValueOnce(LOGIN);
    mocks.getStaffId.mockResolvedValueOnce('staff-1');
    mocks.sendCard.mockResolvedValueOnce({ sent: true, via: 'oto' });
    const result = await run(
      'getTodo',
      { taskId: '57475254077' },
      { botPlatform: 'dingtalk', botThreadId: 'dingtalk:cid_dm' },
    );
    expect(mocks.startLogin).toHaveBeenCalledTimes(1);
    expect(mocks.startLogin).toHaveBeenCalledWith({ origin: 'dingtalk' });
    expect(mocks.getStaffId).toHaveBeenCalledTimes(1);
    expect(mocks.sendCard).toHaveBeenCalledTimes(1);
    expect(mocks.sendCard).toHaveBeenCalledWith({
      db,
      login: LOGIN,
      staffId: 'staff-1',
      threadId: 'dingtalk:cid_dm',
      userId: 'user-1',
    });
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty('error');
    expect(result.content).toContain(DINGTALK_AUTH_LINK);
    expect(result.content).toContain('验证码 JCHB-KBXF');
    expect(result.content).toContain('有效期');
    expect(result.content).toContain(LOGIN.expiresAt);
    expect(result.content).toContain('同时在机器人单聊里发了一张授权卡片');
    expect(result.content).not.toContain('同时在当前会话发了一张授权卡片');
    expect(result.content).not.toContain('若钉钉单聊');
    expect(result.content).toContain('授权后再问我一次即可');
    expect(result.state).toMatchObject({
      authUrl: LOGIN.verificationUrl,
      code: 'DINGTALK_PERSONAL_UNAUTHORIZED',
      kind: 'authorizationRequired',
      login: LOGIN,
      settingsPath: '/settings/connector',
    });
  });

  it('keeps the same verification link when the auth card is not sent', async () => {
    mocks.exec.mockRejectedValue(new DingtalkPersonalError('DINGTALK_PERSONAL_EXPIRED'));
    mocks.startLogin.mockResolvedValue(LOGIN);
    mocks.getStaffId.mockResolvedValue('staff-1');
    mocks.sendCard.mockRejectedValueOnce(new Error('robot down'));
    const thrown = await run('listMyTodos', {}, { botPlatform: 'dingtalk' });
    expect(thrown).not.toHaveProperty('error');
    expect(thrown.content).toContain(DINGTALK_AUTH_LINK);
    expect(thrown.content).toContain('验证码 JCHB-KBXF');
    expect(thrown.content).toContain('有效期');
    expect(thrown.content).not.toContain('授权卡片');
    expect((thrown.state as { authUrl?: string; login?: { userCode?: string } }).authUrl).toBe(
      LOGIN.verificationUrl,
    );
    expect((thrown.state as { login?: { userCode?: string } }).login?.userCode).toBe('JCHB-KBXF');

    mocks.sendCard.mockResolvedValueOnce({ sent: false });
    const declined = await run('listMyTodos', {}, { botPlatform: 'dingtalk' });
    expect(declined.content).toBe(thrown.content);
    expect(declined.content).not.toContain('授权卡片');
    expect(declined).not.toHaveProperty('error');
    expect(mocks.startLogin).toHaveBeenCalledTimes(2);
  });

  it('names the channel that actually delivered the auth card', async () => {
    mocks.exec.mockRejectedValue(new DingtalkPersonalError('DINGTALK_PERSONAL_UNAUTHORIZED'));
    mocks.startLogin.mockResolvedValue(LOGIN);
    mocks.getStaffId.mockResolvedValue('staff-1');

    mocks.sendCard.mockResolvedValueOnce({ sent: true, via: 'session' });
    const session = await run(
      'listMyTodos',
      {},
      { botPlatform: 'dingtalk', botThreadId: 'dingtalk:cid_group:staff-1' },
    );
    expect(mocks.sendCard).toHaveBeenCalledWith({
      db,
      login: LOGIN,
      staffId: 'staff-1',
      threadId: 'dingtalk:cid_group:staff-1',
      userId: 'user-1',
    });
    expect(session).not.toHaveProperty('error');
    expect(session.content).toContain(DINGTALK_AUTH_LINK);
    expect(session.content).toContain('同时在当前会话发了一张授权卡片');
    expect(session.content).not.toContain('同时在机器人单聊里发了一张授权卡片');

    mocks.sendCard.mockResolvedValueOnce({ sent: true });
    const claimed = await run(
      'listMyTodos',
      {},
      { botPlatform: 'dingtalk', botThreadId: 'dingtalk:cid_dm' },
    );
    expect(claimed.content).toContain(DINGTALK_AUTH_LINK);
    expect(claimed.content).not.toContain('授权卡片');
  });

  it('puts the DingTalk permission page URL in PAT_REQUIRED content', async () => {
    const uri = 'https://open.dingtalk.com/permission/cli';
    mocks.exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_PAT_REQUIRED', { uri }),
    );
    const result = await run('getReport', { reportId: 'rpt-1' });
    expect(result.content).toContain(`[打开权限页面](${uri})`);
    expect(result.content).toContain('钉钉自己的权限页面');
    expect(result.error?.code).toBe('DINGTALK_PERSONAL_PAT_REQUIRED');

    mocks.exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_PAT_REQUIRED', { uri: 'javascript:alert(1)' }),
    );
    const blocked = await run('getReport', { reportId: 'rpt-1' });
    expect(blocked.content).not.toContain('javascript:');
    expect(blocked.content).toContain('DINGTALK_PERSONAL_PAT_REQUIRED');

    mocks.exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_PAT_REQUIRED', {
        uri: 'http://open.dingtalk.com/permission/cli',
      }),
    );
    const httpOnly = await run('getReport', { reportId: 'rpt-1' });
    expect(httpOnly.content).not.toContain('http://');
    expect(httpOnly.content).not.toContain('打开权限页面');
    expect(httpOnly.content).toContain('DINGTALK_PERSONAL_PAT_REQUIRED');
  });

  it('replaces an unsafe verification URL with the app authorize link', async () => {
    const unsafe = [
      'javascript:alert(1)',
      'http://login.dingtalk.com/oauth2/device/verify.htm?user_code=JCHB-KBXF',
      'https://evil.example/verify',
    ];
    for (const verificationUrl of unsafe) {
      mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_UNAUTHORIZED'));
      mocks.startLogin.mockResolvedValueOnce({ ...LOGIN, verificationUrl });
      mocks.getStaffId.mockResolvedValueOnce('staff-1');
      mocks.sendCard.mockResolvedValueOnce({ sent: true, via: 'oto' });
      const result = await run(
        'listMyTodos',
        {},
        { botPlatform: 'dingtalk', botThreadId: 'dingtalk:cid_dm' },
      );
      expect(result.content).toContain(DINGTALK_APP_AUTH_LINK);
      expect(result.content).not.toContain(verificationUrl);
      expect(result.content).toContain('验证码 JCHB-KBXF');
      expect((result.state as { authUrl?: string }).authUrl).toBe(DINGTALK_APP_AUTH_URL);
      expect(mocks.sendCard).toHaveBeenCalledWith(
        expect.objectContaining({
          login: expect.objectContaining({ verificationUrl: DINGTALK_APP_AUTH_URL }),
        }),
      );
    }
  });

  it('uses the org-policy sentence and the workspace identity copy', async () => {
    mocks.exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_ORG_POLICY_DENIED'),
    );
    const denied = await run('listMyTodos', {});
    expect(denied.content).toContain(
      '贵司钉钉管理员未开放该功能给 CLI（开发者后台 → [CLI 设置](https://open-dev.dingtalk.com/fe/old#/developerSettings)），请联系管理员',
    );
    expect(denied.content).toContain('DINGTALK_PERSONAL_ORG_POLICY_DENIED');

    mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_IDENTITY_UNBOUND'));
    expect((await run('listMyTodos', {})).content).toBe(
      '当前账号未绑定钉钉身份（DINGTALK_IDENTITY_UNBOUND）。请先用钉钉登录 AIHub（[用钉钉登录](https://aihub.example.com/settings/messenger/dingtalk)），或在钉钉里给机器人发一条消息完成绑定',
    );
    mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_IDENTITY_UNVERIFIED'));
    expect((await run('listMyTodos', {})).content).toContain('DINGTALK_IDENTITY_UNVERIFIED');
    mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_IDENTITY_INACTIVE'));
    expect((await run('listMyTodos', {})).content).toContain('DINGTALK_IDENTITY_INACTIVE');

    mocks.exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_FEATURE_DISABLED', { feature: 'todo' }),
    );
    expect((await run('listMyTodos', {})).content).toContain('管理员未开启「待办」');

    mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_DISABLED'));
    const disabled = await run('listMyTodos', {});
    expect(disabled.content).toContain('管理员未开启钉钉个人数据');
    expect(disabled.content).toContain(
      '[IM 连接器设置](https://aihub.example.com/admin/system/general?tab=im-connectors)',
    );

    mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_IDENTITY_UNBOUND'));
    const inDingTalk = await run('listMyTodos', {}, { botPlatform: 'dingtalk' });
    expect(inDingTalk.content).toContain(
      '[用钉钉登录](https://aihub.example.com/dingtalk/sso?redirect=%2F)',
    );
    expect(inDingTalk.content).not.toMatch(/\]\(<http/);
  });

  it('says a timed-out write may already have happened', async () => {
    const sentence = '这次操作的结果未知，可能已经执行。请先到钉钉里核实，不要重复提交。';
    const cases: Array<[DingtalkPersonalApiName, Record<string, unknown>]> = [
      ['updateTodo', { taskId: '57475254077', title: '改标题' }],
      ['completeTodo', { taskId: '57475254077' }],
      [
        'submitReport',
        {
          contents: [{ content: '写了', key: '今日完成工作' }],
          templateName: '日报',
          toUserIds: ['staff-1'],
        },
      ],
    ];
    for (const [apiName, args] of cases) {
      mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_TIMEOUT'));
      const result = await run(apiName, args);
      expect(result.success).toBe(false);
      expect(result.content).toBe(sentence);
      expect(result.error).toEqual({ code: 'DINGTALK_PERSONAL_TIMEOUT', message: sentence });
    }

    mocks.exec.mockRejectedValueOnce(
      new DingtalkPersonalError('DINGTALK_PERSONAL_BROKER_UNAVAILABLE'),
    );
    const down = await run('completeTodo', { taskId: '57475254077' });
    expect(down.content).toBe(sentence);
    expect(down.error?.code).toBe('DINGTALK_PERSONAL_BROKER_UNAVAILABLE');

    mocks.exec.mockRejectedValueOnce(new DingtalkPersonalError('DINGTALK_PERSONAL_TIMEOUT'));
    const read = await run('getTodo', { taskId: '57475254077' });
    expect(read.content).toContain('DINGTALK_PERSONAL_TIMEOUT');
    expect(read.content).not.toBe(sentence);
  });

  it('does not log report text when a tool call fails', async () => {
    const secret = '今日完成了机密项目代号星海';
    mocks.exec.mockRejectedValueOnce(new Error(`boom ${secret}`));
    const lines: string[] = [];
    const debug = (await import('debug')).default;
    const previousLog = debug.log;
    const previousDebug = process.env.DEBUG;
    debug.enable('lobe-server:dingtalk-personal');
    debug.log = (...args: unknown[]) => {
      lines.push(args.map((item) => String(item)).join(' '));
    };
    try {
      const result = await run('submitReport', {
        contents: [{ content: secret, key: '今日完成工作' }],
        templateName: '日报',
        toUserIds: ['staff-1'],
      });
      expect(result.error?.code).toBe('DINGTALK_PERSONAL_INTERNAL');
      expect(result.content).not.toContain(secret);
      expect(lines.join('\n')).not.toContain(secret);
    } finally {
      debug.log = previousLog;
      debug.disable();
      if (previousDebug !== undefined) {
        process.env.DEBUG = previousDebug;
        debug.enable(previousDebug);
      }
    }
  });

  it('hides unknown errors behind the internal sentence', async () => {
    mocks.exec.mockRejectedValueOnce(new Error('postgres://user:secret@db/lobe'));
    const result = await run('listMyTodos', {});
    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      code: 'DINGTALK_PERSONAL_INTERNAL',
      message: result.content,
    });
    expect(result.content).toContain('DINGTALK_PERSONAL_INTERNAL');
    expect(result.content).not.toContain('secret');
    expect(result.state).toBeUndefined();
  });
});

describe('previewDingtalkPersonalWrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exec.mockReset();
  });

  it('shows the current todo subject and the requested changes', async () => {
    mocks.exec.mockResolvedValueOnce(TODO_GET);
    const preview = await previewDingtalkPersonalWrite(db as never, 'user-1', 'updateTodo', {
      dueTime: '2026-09-25T10:00:00.000Z',
      priority: 40,
      taskId: '57475254077',
      title: '新标题',
    });
    expect(mocks.exec).toHaveBeenCalledWith('todo.get', { taskId: '57475254077' });
    expect(preview.title).toBe('修改待办');
    expect(preview.danger).toBe(false);
    expect(preview.lines[0]).toBe('待办：测试待办 123');
    expect(preview.lines).toContain('标题：测试待办 123 → 新标题');
    expect(preview.lines.some((line) => line.startsWith('优先级：普通 → 紧急'))).toBe(true);
    expect(preview.lines.some((line) => line.startsWith('截止时间：'))).toBe(true);
  });

  it('previews completeTodo from the live subject', async () => {
    mocks.exec.mockResolvedValueOnce(TODO_GET);
    const preview = await previewDingtalkPersonalWrite(db as never, 'user-1', 'completeTodo', {
      taskId: '57475254077',
    });
    expect(preview).toMatchObject({
      danger: false,
      lines: ['待办：测试待办 123'],
      title: '完成待办',
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('resolves recipient names and shows the staff id when the directory has no row', async () => {
    mocks.exec.mockResolvedValueOnce(TEMPLATE);
    const directory = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([{ name: '张三', staffId: 'staff001' }]),
        })),
      })),
    };
    const preview = await previewDingtalkPersonalWrite(
      directory as never,
      'user-1',
      'submitReport',
      {
        contents: [{ content: '写了方案', key: '今日完成工作' }],
        templateName: '日报',
        toUserIds: ['staff001', 'staff002'],
      },
    );
    expect(mocks.exec).toHaveBeenCalledTimes(1);
    expect(mocks.exec).toHaveBeenCalledWith('report.template', { name: '日报' });
    expect(preview.title).toBe('提交「日报」');
    expect(preview.lines).toContain('收件人：张三（staff001）、staff002');
    expect(preview.lines).toContain('今日完成工作：写了方案');
    expect(preview.warnings.some((line) => line.includes('staff002'))).toBe(true);
    expect(preview.warnings.some((line) => line.includes('未完成工作'))).toBe(true);
    expect(preview.danger).toBe(false);
  });

  it('rejects a preview of a read API before calling dws', async () => {
    await expect(
      previewDingtalkPersonalWrite(db as never, 'user-1', 'listMyTodos', {}),
    ).rejects.toMatchObject({ code: 'DINGTALK_PERSONAL_INVALID_ARGS' });
    expect(mocks.exec).not.toHaveBeenCalled();
  });
});
