// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReminderItem, ReminderRecipientItem } from '@/database/schemas/reminder';

import { NOTIFY_APP_NOT_CONFIGURED, runReminderSweep } from './worker';

const acquired = {
  release: vi.fn(async () => {}),
  result: 'acquired' as const,
};

const reminder = (overrides: Partial<ReminderItem> = {}): ReminderItem =>
  ({
    canceledAt: null,
    content: '交安全报告',
    createdAt: new Date('2026-09-16T00:00:00.000Z'),
    createdByAgentId: null,
    createdByUserId: 'user_creator',
    creatorName: '张三',
    fireAt: new Date('2026-09-16T01:00:00.000Z'),
    firedCount: 0,
    id: 'rem_1',
    lastFiredAt: null,
    repeatRule: null,
    source: 'tool',
    status: 'scheduled',
    timezone: 'Asia/Shanghai',
    topicId: null,
    updatedAt: new Date('2026-09-16T00:00:00.000Z'),
    ...overrides,
  }) as ReminderItem;

const recipient = (overrides: Partial<ReminderRecipientItem>): ReminderRecipientItem =>
  ({
    createdAt: new Date(),
    deptId: null,
    deptName: '安环部',
    deptPath: '捷发 / 安环部',
    displayName: '胡玉琴A',
    id: 'rr_1',
    kind: 'user',
    memberCount: null,
    reminderId: 'rem_1',
    staffId: 'staff_hyq',
    updatedAt: new Date(),
    ...overrides,
  }) as ReminderRecipientItem;

describe('runReminderSweep', () => {
  const listDue = vi.fn();
  const recordFire = vi.fn();
  const send = vi.fn();
  const createInbox = vi.fn();
  const resolveUserId = vi.fn();
  const getUsers = vi.fn();
  const subtreeMemberStaffIds = vi.fn();
  const loadRecipients = vi.fn();
  const isNotifyAppConfigured = vi.fn();

  const run = () =>
    runReminderSweep({} as any, {
      acquireLock: async () => acquired,
      createInboxNotification: createInbox,
      getUsers,
      isNotifyAppConfigured,
      listDue,
      loadRecipients,
      now: new Date('2026-09-16T01:00:00.000Z'),
      recordFire,
      resolveUserId,
      sendWorkNotice: send,
      subtreeMemberStaffIds,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    acquired.release.mockClear();
    listDue.mockResolvedValue([reminder()]);
    recordFire.mockResolvedValue(reminder({ status: 'sent' }));
    send.mockResolvedValue([{ taskId: 'task_1' }]);
    createInbox.mockResolvedValue(undefined);
    resolveUserId.mockResolvedValue(null);
    getUsers.mockResolvedValue([{ active: true, staffId: 'staff_hyq' }]);
    subtreeMemberStaffIds.mockResolvedValue(['staff_a', 'staff_b', 'staff_inactive']);
    loadRecipients.mockResolvedValue(new Map([['rem_1', [recipient({})]]]));
    isNotifyAppConfigured.mockResolvedValue(true);
  });

  it('fans out a department, dedupes staffIds, and skips inactive users', async () => {
    loadRecipients.mockResolvedValue(
      new Map([
        [
          'rem_1',
          [
            recipient({ id: 'rr_user', kind: 'user', staffId: 'staff_a' }),
            recipient({
              deptId: 'dept_ah',
              displayName: '安环部',
              id: 'rr_dept',
              kind: 'department',
              staffId: null,
            }),
          ],
        ],
      ]),
    );
    getUsers.mockResolvedValue([
      { active: true, staffId: 'staff_a' },
      { active: false, staffId: 'staff_inactive_direct' },
    ]);
    subtreeMemberStaffIds.mockResolvedValue(['staff_a', 'staff_b']);

    await run();

    expect(send).toHaveBeenCalledTimes(1);
    const sentIds = [...(send.mock.calls[0][0].staffIds as string[])].sort();
    expect(sentIds).toEqual(['staff_a', 'staff_b']);
    const deliveries = recordFire.mock.calls[0][1].deliveries;
    expect(deliveries.map((row: { staffId: string }) => row.staffId).sort()).toEqual([
      'staff_a',
      'staff_b',
    ]);
    expect(deliveries.every((row: { status: string }) => row.status === 'sent')).toBe(true);
    expect(deliveries[0].providerTaskId).toBe('task_1');
  });

  it('writes skipped deliveries when the notify app is missing', async () => {
    isNotifyAppConfigured.mockResolvedValue(false);
    resolveUserId.mockImplementation(async (staffId: string) =>
      staffId === 'staff_hyq' ? 'user_mapped' : null,
    );

    await run();

    expect(send).not.toHaveBeenCalled();
    expect(createInbox).not.toHaveBeenCalled();
    expect(recordFire.mock.calls[0][1].deliveries).toEqual([
      {
        failedReason: NOTIFY_APP_NOT_CONFIGURED,
        providerTaskId: null,
        staffId: 'staff_hyq',
        status: 'skipped',
        userId: 'user_mapped',
      },
    ]);
  });

  it('creates an in-app notification only for mapped users after a successful send', async () => {
    loadRecipients.mockResolvedValue(
      new Map([
        [
          'rem_1',
          [
            recipient({ id: 'rr_1', staffId: 'staff_mapped' }),
            recipient({ id: 'rr_2', staffId: 'staff_nomap' }),
          ],
        ],
      ]),
    );
    getUsers.mockResolvedValue([
      { active: true, staffId: 'staff_mapped' },
      { active: true, staffId: 'staff_nomap' },
    ]);
    resolveUserId.mockImplementation(async (staffId: string) =>
      staffId === 'staff_mapped' ? 'user_mapped' : null,
    );

    await run();

    expect(createInbox).toHaveBeenCalledTimes(1);
    expect(createInbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'reminder:rem_1:2026-09-16T01:00:00.000Z',
        title: '提醒',
        userId: 'user_mapped',
      }),
    );
    expect(createInbox.mock.calls[0][0].content).toContain('交安全报告');
    expect(createInbox.mock.calls[0][0].content).toContain('来自 张三');
  });

  it('skips inactive directory users and does not write a delivery row for them', async () => {
    getUsers.mockResolvedValue([{ active: false, staffId: 'staff_hyq' }]);

    await run();

    expect(send).not.toHaveBeenCalled();
    expect(recordFire.mock.calls[0][1].deliveries).toEqual([]);
  });
});
