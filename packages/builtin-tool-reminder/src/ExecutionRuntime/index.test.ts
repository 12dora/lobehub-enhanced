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
    expect(result.content).not.toMatch(/\n {2}"/);
    expect(create).not.toHaveBeenCalled();
    expect(searchDirectory).toHaveBeenCalledWith('胡玉琴A', undefined);
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
    expect(result.content).not.toContain('已创建定时提醒');
    expect(result.content).toContain('serverNow');
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
    expect(result.content).toContain('serverNow');
  });

  it('lists created reminders as compact JSON with serverNow', async () => {
    const listCreated = vi.fn().mockResolvedValue([
      {
        content: '例会材料',
        nextFireAt: fireAt,
        scheduleSummary: '每周三 09:00',
        status: 'scheduled',
        taskIdentifier: 'TASK-1',
      },
    ]);
    const runtime = createReminderRuntime(makeService({ listCreated }));

    const result = await runtime.listReminders({ scope: 'created' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('"taskIdentifier":"TASK-1"');
    expect(result.content).toContain('"serverNow"');
    expect(result.content).not.toMatch(/\n {2}"/);
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
});
