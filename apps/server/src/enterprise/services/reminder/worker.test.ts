// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReminderItem, ReminderRecipientItem } from '@/database/schemas/reminder';

import {
  formatReminderOaBodyTitle,
  INACTIVE_DELIVERY_REASON,
  NOTIFY_APP_NOT_CONFIGURED,
  runReminderSweep,
} from './worker';

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
  const resolveHeadText = vi.fn();

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
      resolveHeadText,
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
    resolveHeadText.mockResolvedValue('AI平台');
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
    expect(send.mock.calls[0][0].oa).toEqual({
      body: {
        author: '张三',
        content: '交安全报告',
        form: [
          { key: '时间', value: '09:00' },
          { key: '来自', value: '张三' },
        ],
        title: 'AI平台 · 定时提醒',
      },
      head: { bgcolor: 'FF2E7CF6', text: 'AI平台' },
    });
    expect(send.mock.calls[0][0]).not.toHaveProperty('markdown');
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
    expect(recordFire.mock.calls[0][1].deliveries).toEqual([
      {
        failedReason: INACTIVE_DELIVERY_REASON,
        providerTaskId: null,
        staffId: 'staff_hyq',
        status: 'skipped',
        userId: null,
      },
    ]);
    expect(recordFire.mock.calls[0][1].status).toBe('failed');
    expect(recordFire.mock.calls[0][1].nextFireAt).toBeNull();
  });

  it('advances a recurring reminder when every recipient is inactive', async () => {
    listDue.mockResolvedValue([
      reminder({
        repeatRule: { freq: 'daily', time: '09:00' },
      }),
    ]);
    getUsers.mockResolvedValue([{ active: false, staffId: 'staff_hyq' }]);

    await run();

    expect(send).not.toHaveBeenCalled();
    expect(recordFire.mock.calls[0][1].deliveries).toEqual([
      expect.objectContaining({
        failedReason: INACTIVE_DELIVERY_REASON,
        staffId: 'staff_hyq',
        status: 'skipped',
      }),
    ]);
    expect(recordFire.mock.calls[0][1].status).toBe('scheduled');
    expect(recordFire.mock.calls[0][1].nextFireAt).toEqual(new Date('2026-09-17T01:00:00.000Z'));
  });

  it('skips the sweep when the lock is held', async () => {
    const result = await runReminderSweep({} as any, {
      acquireLock: async () => ({ release: vi.fn(), result: 'held' as const }),
      listDue,
      recordFire,
      sendWorkNotice: send,
    });
    expect(result).toEqual({ counts: { failed: 0, fired: 0, skipped: 0 }, lock: 'held' });
    expect(listDue).not.toHaveBeenCalled();
    expect(recordFire).not.toHaveBeenCalled();
  });

  it('chunks more than 100 staffIds and still records the first chunk when the second send fails', async () => {
    const staffIds = Array.from({ length: 101 }, (_, index) => `staff_${index}`);
    loadRecipients.mockResolvedValue(
      new Map([
        ['rem_1', staffIds.map((staffId, index) => recipient({ id: `rr_${index}`, staffId }))],
      ]),
    );
    getUsers.mockResolvedValue(staffIds.map((staffId) => ({ active: true, staffId })));
    send
      .mockResolvedValueOnce([{ taskId: 'task_ok' }])
      .mockRejectedValueOnce(new Error('chunk boom'));

    await run();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].staffIds).toHaveLength(100);
    expect(send.mock.calls[1][0].staffIds).toHaveLength(1);
    const deliveries = recordFire.mock.calls[0][1].deliveries as Array<{
      staffId: string;
      status: string;
    }>;
    expect(deliveries).toHaveLength(101);
    expect(deliveries.filter((row) => row.status === 'sent')).toHaveLength(100);
    expect(deliveries.filter((row) => row.status === 'failed')).toHaveLength(1);
    expect(recordFire).toHaveBeenCalledTimes(1);
  });

  it('appends the repeat summary on the 时间 form value', async () => {
    listDue.mockResolvedValue([
      reminder({
        repeatRule: { freq: 'weekly', time: '09:00', weekdays: [3] },
      }),
    ]);

    await run();

    expect(send.mock.calls[0][0].oa.body.form).toEqual([
      { key: '时间', value: '09:00 · 每周三' },
      { key: '来自', value: '张三' },
    ]);
    expect(send.mock.calls[0][0].oa.body.title).toBe('AI平台 · 定时提醒');
    expect(send.mock.calls[0][0].oa).not.toHaveProperty('messageUrl');
  });

  it('resolves the site-title head text once per sweep', async () => {
    listDue.mockResolvedValue([reminder(), reminder({ id: 'rem_2' })]);
    loadRecipients.mockResolvedValue(
      new Map([
        ['rem_1', [recipient({})]],
        ['rem_2', [recipient({ id: 'rr_2', reminderId: 'rem_2' })]],
      ]),
    );

    await run();

    expect(resolveHeadText).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].oa.head.text).toBe('AI平台');
    expect(send.mock.calls[1][0].oa.head.text).toBe('AI平台');
    expect(send.mock.calls[0][0].oa.body.title).toBe('AI平台 · 定时提醒');
    expect(send.mock.calls[1][0].oa.body.title).toBe('AI平台 · 定时提醒');
  });

  it('still sends head.text while putting the site title in body.title', async () => {
    resolveHeadText.mockResolvedValue('AI 助手');

    await run();

    expect(send.mock.calls[0][0].oa.head).toEqual({ bgcolor: 'FF2E7CF6', text: 'AI 助手' });
    expect(send.mock.calls[0][0].oa.body.title).toBe('AI 助手 · 定时提醒');
  });
});

describe('formatReminderOaBodyTitle', () => {
  it('prefixes 定时提醒 with the site title', () => {
    expect(formatReminderOaBodyTitle('AI平台')).toBe('AI平台 · 定时提醒');
    expect(formatReminderOaBodyTitle('AI 助手')).toBe('AI 助手 · 定时提醒');
  });
});
