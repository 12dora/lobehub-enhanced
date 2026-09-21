// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendWorkNotice = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/messenger/platforms/dingtalk/notifyApp', () => ({
  sendWorkNotice,
}));

const { notifyUser } = await import('./notify');

describe('notifyUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendWorkNotice.mockResolvedValue([{ taskId: '1' }]);
  });

  it('sends a work notice and swallows failures', async () => {
    await notifyUser('staff-1', { lines: ['已按规则处理'], title: '自动审批' });
    expect(sendWorkNotice).toHaveBeenCalledWith({
      markdown: { text: '已按规则处理', title: '自动审批' },
      staffIds: ['staff-1'],
    });

    sendWorkNotice.mockRejectedValueOnce(new Error('network'));
    await expect(notifyUser('staff-1', { lines: ['x'], title: 't' })).resolves.toBeUndefined();
  });
});
