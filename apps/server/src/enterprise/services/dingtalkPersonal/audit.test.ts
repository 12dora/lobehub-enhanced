// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const append = vi.hoisted(() => vi.fn());

vi.mock('@/server/enterprise/services/platformAudit', () => ({
  PlatformAuditService: class {
    append = append;
  },
}));

const { appendDingtalkPersonalAudit } = await import('./audit');

describe('appendDingtalkPersonalAudit', () => {
  const db = {} as never;

  beforeEach(() => {
    append.mockReset();
    append.mockResolvedValue({ id: 'paud_1' });
  });

  it('writes the contract action and an idempotent id for authorize', async () => {
    await appendDingtalkPersonalAudit(db, 'user-a', 'authorize', {
      afterDiff: { corpId: 'dingcorp', staffId: 'staff1' },
      targetId: 'job-1',
    });
    await appendDingtalkPersonalAudit(db, 'user-a', 'authorize', { targetId: 'job-1' });
    expect(append).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'dingtalk.personal.authorize',
        actorUserId: 'user-a',
        id: 'dpp_job-1',
        result: 'success',
        targetId: 'job-1',
        targetType: 'dingtalk_personal',
      }),
    );
    expect(append.mock.calls[1][0].id).toBe('dpp_job-1');
  });

  it('maps revoke and the write actions', async () => {
    await appendDingtalkPersonalAudit(db, 'user-a', 'revoke', { targetId: 'dpa_1' });
    await appendDingtalkPersonalAudit(db, 'user-a', 'todo.update', { targetId: 'task-1' });
    await appendDingtalkPersonalAudit(db, 'user-a', 'todo.complete', { targetId: 'task-1' });
    await appendDingtalkPersonalAudit(db, 'user-a', 'report.submit', { targetId: 'report-1' });
    expect(append.mock.calls.map((call) => call[0].action)).toEqual([
      'dingtalk.personal.revoke',
      'dingtalk.personal.todo.update',
      'dingtalk.personal.todo.complete',
      'dingtalk.personal.report.submit',
    ]);
  });
});
