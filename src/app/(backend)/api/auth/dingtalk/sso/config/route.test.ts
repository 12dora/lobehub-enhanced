// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const getDingTalkSsoConfig = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/messenger/platforms/dingtalk/sso', () => ({
  getDingTalkSsoConfig,
}));

beforeEach(() => {
  getDingTalkSsoConfig.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/auth/dingtalk/sso/config', () => {
  it('returns 404-style JSON when the connector is disabled', async () => {
    getDingTalkSsoConfig.mockResolvedValueOnce({ enabled: false });

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, reason: 'disabled' });
  });

  it('returns corpId from connector settings', async () => {
    getDingTalkSsoConfig.mockResolvedValueOnce({ corpId: 'ding42', enabled: true });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ corpId: 'ding42', enabled: true });
  });

  it('returns corpId captured in Redis when settings omit it', async () => {
    getDingTalkSsoConfig.mockResolvedValueOnce({ corpId: 'ding-from-redis', enabled: true });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ corpId: 'ding-from-redis', enabled: true });
  });
});
