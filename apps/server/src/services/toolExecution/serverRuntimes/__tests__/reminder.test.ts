// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IReminderService } from '../reminder';
import { createReminderRuntime, reminderRuntime } from '../reminder';

const onceSchedule = { date: '2026-09-17', kind: 'once' as const, time: '09:00' };
const fireAt = '2026-09-17T09:00:00+08:00';

const mockCreateReminderTask = vi.fn();
const mockCancel = vi.fn();
const mockListCreated = vi.fn();
const mockListReceived = vi.fn();
const mockSearchDirectory = vi.fn();

vi.mock('@/server/enterprise/services/reminder', () => ({
  ReminderService: vi.fn(() => ({
    searchDirectory: mockSearchDirectory,
  })),
}));

vi.mock('@/server/enterprise/services/reminder/taskReminder', () => ({
  ReminderTaskService: vi.fn(() => ({
    cancel: mockCancel,
    createReminderTask: mockCreateReminderTask,
    listCreated: mockListCreated,
    listReceived: mockListReceived,
  })),
}));

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

describe('createReminderRuntime', () => {
  it('maps createReminder onto the task-service union', async () => {
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

    expect(create).toHaveBeenCalledWith({
      content: '交安全报告',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
    });
    expect(result.success).toBe(true);
    expect(result.content).toContain('TASK-1');
    expect(result.content).toContain('胡玉琴A · 安环部');
    expect(result.state).toMatchObject({
      reminder: { identifier: 'TASK-1' },
      status: 'created',
    });
  });

  it('cancels by taskId', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const runtime = createReminderRuntime(makeService({ cancel }));

    await runtime.cancelReminder({ taskId: 'task-1' });

    expect(cancel).toHaveBeenCalledWith('task-1');
  });
});

describe('reminderRuntime.factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateReminderTask.mockResolvedValue({
      reminder: {
        content: '交安全报告',
        fireAt,
        id: 'rem-1',
        recipients: [],
      },
      status: 'created',
      task: { id: 'task-1', identifier: 'T-12' },
    });
  });

  it('constructs ReminderTaskService with db/user/workspace and fills createdByAgentId/topicId', async () => {
    const { ReminderService } = await import('@/server/enterprise/services/reminder');
    const { ReminderTaskService } =
      await import('@/server/enterprise/services/reminder/taskReminder');
    const serverDB = { tag: 'db' };

    const runtime = await reminderRuntime.factory({
      agentId: 'agent-1',
      serverDB,
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
    } as never);

    expect(ReminderService).toHaveBeenCalledWith(serverDB, 'user-1');
    expect(ReminderTaskService).toHaveBeenCalledWith(serverDB, 'user-1', 'ws-1');

    await runtime.createReminder({
      content: '交安全报告',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
    });

    expect(mockCreateReminderTask).toHaveBeenCalledWith({
      content: '交安全报告',
      createdByAgentId: 'agent-1',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
      topicId: 'topic-1',
    });
  });

  it('normalises empty unused schedule fields and missing time into a clear tool error', async () => {
    const runtime = await reminderRuntime.factory({
      agentId: 'agent-1',
      serverDB: {},
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
    } as never);

    const result = await runtime.createReminder({
      content: '交安全报告',
      recipients: ['胡玉琴A'],
      schedule: {
        date: '2026-09-16',
        kind: 'once',
        monthDays: [],
        time: '',
        until: '',
        weekdays: [],
      } as never,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('schedule.time');
    expect(result.content).toContain('"serverNow"');
    expect(mockCreateReminderTask).not.toHaveBeenCalled();
  });

  it('forwards an optional title into createReminderTask', async () => {
    const runtime = await reminderRuntime.factory({
      agentId: 'agent-1',
      serverDB: {},
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
    } as never);

    await runtime.createReminder({
      content: '交安全报告',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
      title: '交安全报告',
    });

    expect(mockCreateReminderTask).toHaveBeenCalledWith({
      content: '交安全报告',
      createdByAgentId: 'agent-1',
      recipients: ['胡玉琴A'],
      schedule: onceSchedule,
      title: '交安全报告',
      topicId: 'topic-1',
    });
  });

  it('rejects kind-specific invalid schedules before calling ReminderTaskService', async () => {
    const runtime = await reminderRuntime.factory({
      agentId: 'agent-1',
      serverDB: {},
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
    } as never);

    const result = await runtime.createReminder({
      content: '交安全报告',
      recipients: ['胡玉琴A'],
      schedule: { kind: 'weekly', time: '09:00' },
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('"serverNow"');
    expect(mockCreateReminderTask).not.toHaveBeenCalled();
  });
});
