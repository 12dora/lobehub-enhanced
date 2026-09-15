// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';

import { GET } from './route';

const userServiceMocks = vi.hoisted(() => ({
  getUserAvatar: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/database/server', () => ({
  serverDB: {},
}));

vi.mock('@/server/services/user', () => ({
  UserService: class {
    getUserAvatar = userServiceMocks.getUserAvatar;
  },
}));

describe('GET /webapi/user/avatar/:id/:image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'viewer-id' },
    } as never);
    userServiceMocks.getUserAvatar.mockResolvedValue(Buffer.from('avatar-bytes'));
  });

  it('returns 401 for an anonymous request', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const response = await GET(new Request('https://lobehub.com/webapi/user/avatar/u1/a.png'), {
      params: Promise.resolve({ id: 'u1', image: 'a.png' }),
    });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Unauthorized');
    expect(userServiceMocks.getUserAvatar).not.toHaveBeenCalled();
  });

  it('lets any signed-in user fetch another user avatar', async () => {
    const response = await GET(new Request('https://lobehub.com/webapi/user/avatar/u1/a.png'), {
      params: Promise.resolve({ id: 'u1', image: 'a.png' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('avatar-bytes');
    expect(userServiceMocks.getUserAvatar).toHaveBeenCalledWith('u1', 'a.png');
  });

  it('returns 404 when the avatar object is missing', async () => {
    userServiceMocks.getUserAvatar.mockResolvedValue(null);

    const response = await GET(new Request('https://lobehub.com/webapi/user/avatar/u1/a.png'), {
      params: Promise.resolve({ id: 'u1', image: 'a.png' }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Avatar not found');
  });

  it.each([
    { image: 'a.png', id: 'u1/../u2' },
    { image: '../secret.png', id: 'u1' },
    { image: 'a.png', id: 'u1\\evil' },
    { image: 'foo\\bar.png', id: 'u1' },
    { image: 'a.png', id: '..' },
  ])('returns 400 for path traversal in id/image ($id / $image)', async ({ id, image }) => {
    const response = await GET(new Request('https://lobehub.com/webapi/user/avatar/x/y'), {
      params: Promise.resolve({ id, image }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Bad request');
    expect(auth.api.getSession).not.toHaveBeenCalled();
    expect(userServiceMocks.getUserAvatar).not.toHaveBeenCalled();
  });
});
