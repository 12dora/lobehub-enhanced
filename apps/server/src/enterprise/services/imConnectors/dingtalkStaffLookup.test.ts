// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lookupDingTalkStaff } from './dingtalkStaffLookup';

const jsonResponse = (body: unknown) =>
  ({
    json: async () => body,
    ok: true,
    status: 200,
  }) as const;

describe('lookupDingTalkStaff', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the corp display name when user/get succeeds', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (String(input).includes('gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0 });
      }
      return jsonResponse({ errcode: 0, result: { name: 'Alice', userid: 'staff_1' } });
    });

    await expect(
      lookupDingTalkStaff({
        clientId: 'app',
        clientSecret: 'secret',
        fetchImpl,
        staffId: 'staff_1',
      }),
    ).resolves.toEqual({ name: 'Alice' });
  });

  it('returns null when the staff id is missing at DingTalk', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (String(input).includes('gettoken')) {
        return jsonResponse({ access_token: 'tok', errcode: 0 });
      }
      return jsonResponse({ errcode: 60121, errmsg: 'user not found' });
    });

    await expect(
      lookupDingTalkStaff({
        clientId: 'app',
        clientSecret: 'secret',
        fetchImpl,
        staffId: 'missing',
      }),
    ).resolves.toBeNull();
  });

  it('returns null when the token call fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errcode: 40001, errmsg: 'invalid' }));

    await expect(
      lookupDingTalkStaff({
        clientId: 'app',
        clientSecret: 'secret',
        fetchImpl,
        staffId: 'staff_1',
      }),
    ).resolves.toBeNull();
  });
});
