import { describe, expect, it, vi } from 'vitest';

import type { IReminderService } from './index';
import { createReminderRuntime } from './index';

const fireAt = '2026-09-17T09:00:00+08:00';

const onceSchedule = { date: '2026-09-17', kind: 'once' as const, time: '09:00' };

const makeService = (overrides: Partial<IReminderService> = {}): IReminderService => ({
  cancel: vi.fn(),
  create: vi.fn(),
  listCreated: vi.fn().mockResolvedValue([]),
  listReceived: vi.fn().mockResolvedValue([]),
  searchDirectory: vi.fn().mockResolvedValue({
    ambiguous: false,
    departments: [],
    serverNow: '2026-09-16T12:00:00+08:00',
    users: [],
  }),
  ...overrides,
});

describe('ReminderExecutionRuntime', () => {
  it('returns compact search JSON with serverNow and does not pretty-print', async () => {
    const create = vi.fn();
    const searchDirectory = vi.fn().mockResolvedValue({
      ambiguous: true,
      departments: [],
      serverNow: '2026-09-16T12:00:00+08:00',
      users: [
        {
          deptPath: '捷发 / 安环部',
          leafDeptName: '安环部',
          name: '胡玉琴A',
          staffId: 'staff-1',
        },
        {
          deptPath: '捷发 / 财务部',
          leafDeptName: '财务部',
          name: '胡玉琴A',
          staffId: 'staff-2',
        },
      ],
    });
    const runtime = createReminderRuntime(makeService({ create, searchDirectory }));

    const result = await runtime.searchDirectory({ q: '胡玉琴A' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      ambiguous: true,
      serverNow: '2026-09-16T12:00:00+08:00',
      userCount: 2,
    });
    expect(result.content).toContain('"serverNow":"2026-09-16T12:00:00+08:00"');
    expect(result.content).toContain('请列出「姓名 · 部门」请用户选择后再调用 createReminder');
    expect(result.content).not.toMatch(/\n {2}"/);
    expect(create).not.toHaveBeenCalled();
    expect(searchDirectory).toHaveBeenCalledWith('胡玉琴A', undefined);
  });

  it('tells the model to copy searchDirectory staff/dept tokens verbatim', async () => {
    const searchDirectory = vi.fn().mockResolvedValue({
      ambiguous: false,
      departments: [],
      serverNow: '2026-09-16T12:00:00+08:00',
      users: [{ leafDeptName: '外贸组', name: '陈柠', staffId: '173abc' }],
    });
    const runtime = createReminderRuntime(makeService({ searchDirectory }));

    const result = await runtime.searchDirectory({ q: '陈柠' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('staff:<id>/dept:<id>');
    expect(result.content).toContain('原样传入 createReminder');
    expect(result.content).toContain('不要改写汉字');
    expect(result.content).toContain('173abc');
  });

  it('returns needs_clarification without creating', async () => {
    const create = vi.fn().mockResolvedValue({
      ambiguous: [
        {
          candidates: [
            { deptPath: '捷发 / 安环部', leafDeptName: '安环部', name: '胡玉琴A', staffId: 's1' },
            { deptPath: '捷发 / 财务部', leafDeptName: '财务部', name: '胡玉琴A', staffId: 's2' },
          ],
          query: '胡玉琴A',
        },
      ],
      status: 'needs_clarification',
      unknown: [],
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '测试一下',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      needsClarification: true,
      status: 'needs_clarification',
    });
    expect(result.content).toContain('needs_clarification');
    expect(result.content).toContain('安环部');
    expect(result.content).toContain('请列出候选「姓名 · 部门」请用户选择后再重试');
    expect(result.content).not.toContain('已创建定时提醒');
    expect(result.content).not.toContain('searchDirectory');
    expect(result.content).not.toContain('最接近');
    expect(result.content).toContain('serverNow');
  });

  it('tells the model to retry with suggested staff tokens for unknown near-matches', async () => {
    const create = vi.fn().mockResolvedValue({
      ambiguous: [],
      status: 'needs_clarification',
      unknown: ['陈柑'],
      unknownSuggestions: [
        {
          candidates: [
            {
              deptPath: '捷发 / 外贸组',
              leafDeptName: '外贸组',
              name: '陈柠',
              staffId: '173abc',
            },
          ],
          query: '陈柑',
        },
      ],
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '考勤',
      recipients: ['陈柑'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      needsClarification: true,
      unknown: ['陈柑'],
      unknownSuggestions: [
        {
          query: '陈柑',
          candidates: [expect.objectContaining({ name: '陈柠', staffId: '173abc' })],
        },
      ],
    });
    expect(result.content).toContain('未找到「陈柑」');
    expect(result.content).toContain('陈柠 · 外贸组（staff:173abc）');
    expect(result.content).toContain('请直接用该 token 重试 createReminder');
    expect(result.content).toContain('不要改写汉字');
    expect(result.content).toContain('不要询问用户');
    expect(result.content).toContain('"unknownSuggestions"');
    expect(result.content).not.toContain('请列出候选');
    expect(result.content).not.toContain('请调用一次 searchDirectory');
    expect(result.content).not.toContain('不要自行挑选');
  });

  it('explains a user_text-narrowed suggestion and tells the model to retry with the token', async () => {
    const create = vi.fn().mockResolvedValue({
      ambiguous: [],
      status: 'needs_clarification',
      unknown: ['陈染'],
      unknownSuggestions: [
        {
          candidates: [
            {
              deptPath: '捷发 / 外贸组',
              leafDeptName: '外贸组',
              name: '陈柠',
              staffId: '173abc',
            },
          ],
          query: '陈染',
          reason: 'user_text',
        },
      ],
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '考勤',
      recipients: ['陈染'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      '未找到「陈染」。用户原文写的是「陈柠」（陈柠 · 外贸组，staff:173abc），请直接用该 token 重试 createReminder。',
    );
    expect(result.content).not.toContain('请列出候选');
    expect(result.content).not.toContain('不要询问用户');
    expect(result.content).not.toContain('通讯录中最接近');
    expect(result.content).not.toContain('与其他收件人同在');
  });

  it('explains a co_recipient_dept-narrowed suggestion and tells the model to retry with the token', async () => {
    const create = vi.fn().mockResolvedValue({
      ambiguous: [],
      status: 'needs_clarification',
      unknown: ['陈染'],
      unknownSuggestions: [
        {
          candidates: [
            {
              deptPath: '捷发 / 外贸组',
              leafDeptName: '外贸组',
              name: '陈柠',
              staffId: '173abc',
            },
          ],
          query: '陈染',
          reason: 'co_recipient_dept',
        },
      ],
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '考勤',
      recipients: ['刘钢', '钱宝国', '陈染'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      '未找到「陈染」。与其他收件人同在外贸组（陈柠 · 外贸组，staff:173abc），请直接用该 token 重试 createReminder。',
    );
    expect(result.content).not.toContain('请列出候选');
    expect(result.content).not.toContain('不要询问用户');
    expect(result.content).not.toContain('用户原文写的是');
    expect(result.content).not.toContain('通讯录中最接近');
  });

  it('asks the user when an unknown query has two or more near-match candidates', async () => {
    const create = vi.fn().mockResolvedValue({
      ambiguous: [],
      status: 'needs_clarification',
      unknown: ['陈柑'],
      unknownSuggestions: [
        {
          candidates: [
            {
              deptPath: '捷发 / 外贸组',
              leafDeptName: '外贸组',
              name: '陈柠',
              staffId: '173abc',
            },
            {
              deptPath: '捷发 / 财务部',
              leafDeptName: '财务部',
              name: '陈楠',
              staffId: '174def',
            },
          ],
          query: '陈柑',
        },
      ],
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '考勤',
      recipients: ['陈柑'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('未找到「陈柑」');
    expect(result.content).toContain('陈柠 · 外贸组（staff:173abc）');
    expect(result.content).toContain('陈楠 · 财务部（staff:174def）');
    expect(result.content).toContain('请列出候选「姓名 · 部门」请用户选择后再重试');
    expect(result.content).toContain('不要自行挑选');
    expect(result.content).not.toContain('不要询问用户');
    expect(result.content).not.toContain('请直接用该 token 重试');
    expect(result.content).not.toContain('请调用一次 searchDirectory');
  });

  it('tells the model to searchDirectory once when unknown has no suggestions', async () => {
    const create = vi.fn().mockResolvedValue({
      ambiguous: [],
      status: 'needs_clarification',
      unknown: ['陈柑'],
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '考勤',
      recipients: ['陈柑'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      needsClarification: true,
      unknown: ['陈柑'],
    });
    expect(result.state).not.toHaveProperty('unknownSuggestions');
    expect(result.content).toContain('未找到「陈柑」');
    expect(result.content).toContain('请调用一次 searchDirectory');
    expect(result.content).toContain('staff:<id>/dept:<id>');
    expect(result.content).toContain('原样重试 createReminder');
    expect(result.content).not.toContain('最接近');
    expect(result.content).not.toContain('请列出候选');
  });

  it('splits clarification copy when unknown suggestions and ambiguous names both appear', async () => {
    const create = vi.fn().mockResolvedValue({
      ambiguous: [
        {
          candidates: [
            { deptPath: '捷发 / 安环部', leafDeptName: '安环部', name: '胡玉琴A', staffId: 's1' },
            { deptPath: '捷发 / 财务部', leafDeptName: '财务部', name: '胡玉琴A', staffId: 's2' },
          ],
          query: '胡玉琴A',
        },
      ],
      status: 'needs_clarification',
      unknown: ['陈柑', '不存在的人'],
      unknownSuggestions: [
        {
          candidates: [
            {
              deptPath: '捷发 / 外贸组',
              leafDeptName: '外贸组',
              name: '陈柠',
              staffId: '173abc',
            },
          ],
          query: '陈柑',
        },
      ],
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '考勤',
      recipients: ['陈柑', '胡玉琴A', '不存在的人'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('未找到「陈柑」');
    expect(result.content).toContain('staff:173abc');
    expect(result.content).toContain('请直接用该 token 重试 createReminder');
    expect(result.content).toContain('不要询问用户');
    expect(result.content).toContain('未找到「不存在的人」');
    expect(result.content).toContain('请调用一次 searchDirectory');
    expect(result.content).toContain('请列出候选「姓名 · 部门」请用户选择后再重试');
  });

  it('returns needs_confirmation without treating it as a created reminder', async () => {
    const create = vi.fn().mockResolvedValue({
      audience: [{ deptId: 'dept-1', memberCount: 42, name: '安环部' }],
      status: 'needs_confirmation',
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      confirmLargeAudience: false,
      content: '周五下午开会',
      recipients: ['安环部'],
      schedule: onceSchedule,
    });

    expect(create).toHaveBeenCalledWith({
      confirmLargeAudience: false,
      content: '周五下午开会',
      recipients: ['安环部'],
      schedule: onceSchedule,
    });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      audience: [{ deptId: 'dept-1', memberCount: 42, name: '安环部' }],
      needsConfirmation: true,
    });
    expect(result.state?.reminder).toBeUndefined();
    expect(result.content).toContain('needs_confirmation');
    expect(result.content).toContain('confirmLargeAudience');
    expect(result.content).not.toContain('已创建定时提醒');
  });

  it('returns the created reminder with task identifier and schedule summary', async () => {
    const create = vi.fn().mockResolvedValue({
      reminder: {
        content: '交安全报告',
        fireAt,
        id: 'rem-1',
        recipients: [
          {
            deptName: '安环部',
            deptPath: '捷发 / 安环部',
            displayName: '胡玉琴A',
            kind: 'user',
            staffId: 'staff-1',
          },
        ],
      },
      status: 'created',
      task: {
        config: {
          reminder: {
            kind: 'reminder',
            once: true,
            reminderId: 'rem-1',
            schedule: onceSchedule,
            scheduleSummary: '2026-09-17 09:00 一次',
          },
        },
        id: 'task-1',
        identifier: 'TASK-1',
      },
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '交安全报告',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      reminder: { identifier: 'TASK-1', scheduleSummary: '2026-09-17 09:00 一次' },
      status: 'created',
      success: true,
    });
    expect(result.content).toContain('已创建定时提醒');
    expect(result.content).toContain('胡玉琴A · 安环部');
    expect(result.content).toContain('交安全报告');
    expect(result.content).toContain('TASK-1');
    expect(result.content).toContain('"taskId":"task-1"');
    expect(result.content).toContain('"taskIdentifier":"TASK-1"');
    expect(result.content).toContain('serverNow');
  });

  it('formats Date fire times as Asia/Shanghai in LLM content, not UTC', async () => {
    const create = vi.fn().mockResolvedValue({
      reminder: {
        content: '交安全报告',
        fireAt: new Date('2026-09-17T01:00:00.000Z'),
        id: 'rem-1',
        recipients: [],
      },
      status: 'created',
      task: { id: 'task-1', identifier: 'T-12' },
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '交安全报告',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('+08:00');
    expect(result.content).toContain('09:00');
    expect(result.content).not.toContain('T01:00');
    expect(result.content).toContain('"taskId":"task-1"');
    expect(result.content).toContain('"taskIdentifier":"T-12"');
  });

  it('includes serverNow on create failure including REMINDER_TIME_PAST', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('REMINDER_TIME_PAST'), { code: 'REMINDER_TIME_PAST' }),
      );
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '交安全报告',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('REMINDER_TIME_PAST');
    expect(result.content).toContain('"serverNow"');
    expect(result.content).toMatch(/\+08:00"/);
    expect(result.error).toEqual({
      code: 'REMINDER_TIME_PAST',
      message: expect.stringContaining('REMINDER_TIME_PAST'),
    });
  });

  it('maps REMINDER_CONTENT_EMPTY and REMINDER_RECIPIENT_UNKNOWN without swallowing the code', async () => {
    const runtimeEmpty = createReminderRuntime(
      makeService({
        create: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('content blank'), { code: 'REMINDER_CONTENT_EMPTY' }),
          ),
      }),
    );
    const empty = await runtimeEmpty.createReminder({
      content: ' ',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
    });
    expect(empty.success).toBe(false);
    expect(empty.content).toContain('REMINDER_CONTENT_EMPTY');
    expect(empty.content).toContain('提醒内容为空');

    const runtimeUnknown = createReminderRuntime(
      makeService({
        create: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('no such person'), { code: 'REMINDER_RECIPIENT_UNKNOWN' }),
          ),
      }),
    );
    const unknown = await runtimeUnknown.createReminder({
      content: '考勤',
      recipients: ['nobody'],
      schedule: onceSchedule,
    });
    expect(unknown.success).toBe(false);
    expect(unknown.content).toContain('REMINDER_RECIPIENT_UNKNOWN');
    expect(unknown.content).toContain('收件人无法解析');
  });

  it('keeps schedule parse errors visible to the model', async () => {
    const runtimeInvalid = createReminderRuntime(
      makeService({
        create: vi.fn().mockRejectedValue(new Error('Invalid schedule: time: Required')),
      }),
    );
    const invalid = await runtimeInvalid.createReminder({
      content: '考勤',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
    });
    expect(invalid.success).toBe(false);
    expect(invalid.content).toContain('Invalid schedule: time: Required');
    expect(invalid.content).not.toContain('内部错误');

    const runtimeMissing = createReminderRuntime(
      makeService({
        create: vi
          .fn()
          .mockRejectedValue(
            new Error('Missing required field: schedule.time (HH:mm in Asia/Shanghai).'),
          ),
      }),
    );
    const missing = await runtimeMissing.createReminder({
      content: '考勤',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
    });
    expect(missing.content).toContain('Missing required field: schedule.time');

    const runtimeCode = createReminderRuntime(
      makeService({
        create: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('weekdays required'), { code: 'REMINDER_SCHEDULE_INVALID' }),
          ),
      }),
    );
    const coded = await runtimeCode.createReminder({
      content: '考勤',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
    });
    expect(coded.content).toContain('REMINDER_SCHEDULE_INVALID');
    expect(coded.content).toContain('weekdays required');
  });

  it('maps REMINDER_CREATE_RETRY to a same-args retry instruction', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('REMINDER_CREATE_RETRY'), { code: 'REMINDER_CREATE_RETRY' }),
      );
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '考勤',
      recipients: ['staff:173abc'],
      schedule: onceSchedule,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('临时冲突');
    expect(result.content).toContain('相同参数重试一次 createReminder');
    expect(result.content).toContain('无需重新搜索');
    expect(result.content).toContain('"serverNow"');
  });

  it('maps REMINDER_INTERNAL to a generic message without the original text', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error('Failed query: select COALESCE(MAX(seq) from tasks'), {
        code: 'REMINDER_INTERNAL',
      }),
    );
    const runtime = createReminderRuntime(makeService({ create }));

    try {
      const result = await runtime.createReminder({
        content: '考勤',
        recipients: ['staff:173abc'],
        schedule: onceSchedule,
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('内部错误');
      expect(result.content).not.toContain('Failed query');
      expect(result.content).not.toContain('COALESCE');
      expect(JSON.stringify(result.error)).not.toContain('Failed query');
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not leak SQL text for an unmapped drizzle insert failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const create = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Failed query: insert into reminder_recipients ("reminder_id", "kind", "dept_id") values ($1, $2, $3)',
        ),
      );
    const runtime = createReminderRuntime(makeService({ create }));

    try {
      const result = await runtime.createReminder({
        content: '考勤',
        recipients: ['staff:040', 'staff:026', 'staff:173'],
        schedule: onceSchedule,
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('内部错误');
      expect(result.content).not.toContain('Failed query');
      expect(result.content).not.toContain('insert into');
      expect(result.content).not.toContain('reminder_recipients');
      expect(JSON.stringify(result.error ?? {})).not.toContain('Failed query');
      expect(JSON.stringify(result.error ?? {})).not.toContain('insert into');
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('lists created reminders as compact JSON with taskId, taskIdentifier, and Shanghai nextFireAt', async () => {
    const listCreated = vi.fn().mockResolvedValue([
      {
        content: '例会材料',
        nextFireAt: new Date('2026-09-17T01:00:00.000Z'),
        scheduleSummary: '每周三 09:00',
        status: 'scheduled',
        taskId: 'task-1',
        taskIdentifier: 'TASK-1',
      },
    ]);
    const runtime = createReminderRuntime(makeService({ listCreated }));

    const result = await runtime.listReminders({ scope: 'created' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('"taskId":"task-1"');
    expect(result.content).toContain('"taskIdentifier":"TASK-1"');
    expect(result.content).toContain('"serverNow"');
    expect(result.content).toContain('2026-09-17T09:00:00+08:00');
    expect(result.content).not.toContain('T01:00');
    expect(result.content).not.toMatch(/\n {2}"/);
  });

  it('formats received firedAt as Asia/Shanghai in LLM JSON', async () => {
    const listReceived = vi.fn().mockResolvedValue([
      {
        content: '例会材料',
        creatorName: '张伟',
        firedAt: new Date('2026-09-17T01:00:00.000Z'),
        id: 'dlv-1',
        reminderId: 'rem-1',
      },
    ]);
    const runtime = createReminderRuntime(makeService({ listReceived }));

    const result = await runtime.listReminders({ scope: 'received' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('2026-09-17T09:00:00+08:00');
    expect(result.content).not.toContain('T01:00');
  });

  it('cancels by taskId', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const runtime = createReminderRuntime(makeService({ cancel }));

    const result = await runtime.cancelReminder({ taskId: 'task-1' });

    expect(cancel).toHaveBeenCalledWith('task-1');
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ success: true, taskId: 'task-1' });
    expect(result.content).toContain('task-1');
  });

  it('maps REMINDER_NOT_FOUND on cancel without attaching the raw error', async () => {
    const cancel = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('REMINDER_NOT_FOUND'), { code: 'REMINDER_NOT_FOUND' }),
      );
    const runtime = createReminderRuntime(makeService({ cancel }));

    const result = await runtime.cancelReminder({ taskId: 'T-99' });

    expect(result.success).toBe(false);
    expect(result.content).toContain('REMINDER_NOT_FOUND');
    expect(result.content).toContain('未找到提醒');
    expect(result.error).toEqual({
      code: 'REMINDER_NOT_FOUND',
      message: expect.stringContaining('REMINDER_NOT_FOUND'),
    });
  });
});

const DINGTALK_SQL_ERROR = new Error(
  'Failed query: select id, name from dingtalk_users where name = $1',
);

const expectNoSqlLeak = (result: { content: string; error?: unknown; state?: unknown }) => {
  const serialized = JSON.stringify({
    content: result.content,
    error: result.error ?? null,
    state: result.state ?? null,
  });
  expect(result.content).toContain('内部错误');
  expect(result.content).not.toContain('Failed query');
  expect(result.content).not.toContain('select ');
  expect(result.content).not.toContain('dingtalk_');
  expect(serialized).not.toContain('Failed query');
  expect(serialized).not.toContain('select ');
  expect(serialized).not.toContain('dingtalk_');
  expect(result.error).toEqual({
    code: 'REMINDER_INTERNAL',
    message: expect.stringContaining('内部错误'),
  });
};

describe('ReminderExecutionRuntime SQL sanitizer', () => {
  it('does not leak SQL from createReminder failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runtime = createReminderRuntime(
      makeService({ create: vi.fn().mockRejectedValue(DINGTALK_SQL_ERROR) }),
    );

    try {
      const result = await runtime.createReminder({
        content: '考勤',
        recipients: ['陈柠'],
        schedule: onceSchedule,
      });
      expect(result.success).toBe(false);
      expectNoSqlLeak(result);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not leak SQL from searchDirectory failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runtime = createReminderRuntime(
      makeService({ searchDirectory: vi.fn().mockRejectedValue(DINGTALK_SQL_ERROR) }),
    );

    try {
      const result = await runtime.searchDirectory({ q: '陈柠' });
      expect(result.success).toBe(false);
      expectNoSqlLeak(result);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not leak SQL from listReminders failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runtime = createReminderRuntime(
      makeService({ listCreated: vi.fn().mockRejectedValue(DINGTALK_SQL_ERROR) }),
    );

    try {
      const result = await runtime.listReminders({ scope: 'created' });
      expect(result.success).toBe(false);
      expectNoSqlLeak(result);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not leak SQL from cancelReminder failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runtime = createReminderRuntime(
      makeService({ cancel: vi.fn().mockRejectedValue(DINGTALK_SQL_ERROR) }),
    );

    try {
      const result = await runtime.cancelReminder({ taskId: 'T-12' });
      expect(result.success).toBe(false);
      expectNoSqlLeak(result);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
