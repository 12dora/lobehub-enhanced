// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lookupDingTalkStaff } from './dingtalkStaffLookup';

const fetchDingTalkContact = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/messenger/platforms/dingtalk/provision', () => ({
  fetchDingTalkContact,
}));

describe('lookupDingTalkStaff', () => {
  beforeEach(() => {
    fetchDingTalkContact.mockReset();
  });

  it('returns the corp display name from fetchDingTalkContact', async () => {
    fetchDingTalkContact.mockResolvedValueOnce({ avatar: 'https://img', name: 'Alice' });

    await expect(lookupDingTalkStaff('staff_1')).resolves.toEqual({ name: 'Alice' });
    expect(fetchDingTalkContact).toHaveBeenCalledWith('staff_1');
  });

  it('returns null when the provision client cannot resolve the staff id', async () => {
    fetchDingTalkContact.mockResolvedValueOnce(null);

    await expect(lookupDingTalkStaff('missing')).resolves.toBeNull();
  });
});
