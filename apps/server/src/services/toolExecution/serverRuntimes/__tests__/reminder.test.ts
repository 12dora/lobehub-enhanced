// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { IReminderService } from '../reminder';
import { createReminderRuntime } from '../reminder';

const fireAt = '2026-09-17T09:00:00+08:00';

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
  it('marks ambiguous same-name hits and does not create', async () => {
    const create = vi.fn();
    const searchDirectory = vi.fn().mockResolvedValue({
      ambiguous: true,
      departments: [],
      serverNow: '2026-09-16T12:00:00+08:00',
      users: [
        {
          leafDeptName: '安环部',
          name: '胡玉琴A',
          staffId: 'staff-1',
          deptPath: '捷发 / 安环部',
        },
        {
          leafDeptName: '财务部',
          name: '胡玉琴A',
          staffId: 'staff-2',
          deptPath: '捷发 / 财务部',
        },
      ],
    });
    const runtime = createReminderRuntime(makeService({ create, searchDirectory }));

    const result = await runtime.searchDirectory({ q: '胡玉琴A' });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({ ambiguous: true, userCount: 2 });
    expect(result.content).toContain('ambiguous');
    expect(result.content).toContain('不要猜测');
    expect(create).not.toHaveBeenCalled();
    expect(searchDirectory).toHaveBeenCalledWith('胡玉琴A', undefined);
  });

  it('passes through needsConfirmation without treating it as a created reminder', async () => {
    const create = vi.fn().mockResolvedValue({
      audience: [{ deptId: 'dept-1', memberCount: 42, name: '安环部' }],
      needsConfirmation: true,
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '周五下午开会',
      fireAt,
      recipients: [{ deptId: 'dept-1', kind: 'department' }],
    });

    expect(create).toHaveBeenCalledWith({
      content: '周五下午开会',
      fireAt,
      recipients: [{ deptId: 'dept-1', kind: 'department' }],
    });
    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      needsConfirmation: true,
      audience: [{ deptId: 'dept-1', memberCount: 42, name: '安环部' }],
    });
    expect(result.state?.reminder).toBeUndefined();
    expect(result.content).toContain('needsConfirmation');
    expect(result.content).toContain('confirmLargeAudience');
    expect(result.content).not.toContain('已创建定时提醒');
  });

  it('returns the created reminder on success', async () => {
    const create = vi.fn().mockResolvedValue({
      content: '交安全报告',
      creatorName: '张三',
      fireAt,
      id: 'rem-1',
      recipients: [
        {
          deptName: '安环部',
          displayName: '胡玉琴A',
          kind: 'user',
          staffId: 'staff-1',
        },
      ],
      repeat: null,
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '交安全报告',
      fireAt,
      recipients: [{ kind: 'user', staffId: 'staff-1' }],
    });

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      needsConfirmation: false,
      reminder: { id: 'rem-1', creatorName: '张三' },
      success: true,
    });
    expect(result.content).toContain('已创建定时提醒');
    expect(result.content).toContain('胡玉琴A');
    expect(result.content).toContain('交安全报告');
    expect(result.content).toContain('rem-1');
  });

  it('maps repeatRule onto repeat so the weekly summary is not 一次性', async () => {
    const create = vi.fn().mockResolvedValue({
      content: '交安全报告',
      creatorName: '张三',
      fireAt,
      id: 'rem-1',
      recipients: [
        {
          deptName: '安环部',
          displayName: '胡玉琴A',
          kind: 'user',
          staffId: 'staff-1',
        },
      ],
      repeatRule: { freq: 'weekly', time: '09:00', weekdays: [3] },
    });
    const runtime = createReminderRuntime(makeService({ create }));

    const result = await runtime.createReminder({
      content: '交安全报告',
      fireAt,
      recipients: [{ kind: 'user', staffId: 'staff-1' }],
      repeat: { freq: 'weekly', time: '09:00', weekdays: [3] },
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('每周三 09:00');
    expect(result.content).not.toContain('一次性');
    expect(result.state).toMatchObject({
      reminder: { id: 'rem-1', repeat: { freq: 'weekly', time: '09:00', weekdays: [3] } },
    });
  });
});
