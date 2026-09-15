// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { IM_CONNECTOR_STREAM_STATUS_KEY, readImConnectorStatus } from './status';

describe('readImConnectorStatus', () => {
  it('returns unknown when Redis has no key', async () => {
    const redis = { get: vi.fn(async () => null) };

    await expect(
      readImConnectorStatus({ platform: 'dingtalk', redis, rowDisabled: false }),
    ).resolves.toEqual({
      connectedAt: null,
      lastError: null,
      lastErrorAt: null,
      lastEventAt: null,
      lastFrameAt: null,
      state: 'unknown',
    });
    expect(redis.get).toHaveBeenCalledWith(IM_CONNECTOR_STREAM_STATUS_KEY('dingtalk'));
  });

  it('returns unknown when Redis is unavailable', async () => {
    await expect(
      readImConnectorStatus({ platform: 'dingtalk', redis: null, rowDisabled: false }),
    ).resolves.toMatchObject({ state: 'unknown' });
  });

  it('forces disabled when the connector row is off', async () => {
    const redis = {
      get: vi.fn(async () =>
        JSON.stringify({
          connectedAt: '2026-09-15T00:00:00.000Z',
          lastError: null,
          lastErrorAt: null,
          lastEventAt: '2026-09-15T00:00:01.000Z',
          pid: 12,
          state: 'connected',
          updatedAt: '2026-09-15T00:00:02.000Z',
        }),
      ),
    };

    await expect(
      readImConnectorStatus({ platform: 'dingtalk', redis, rowDisabled: true }),
    ).resolves.toMatchObject({
      connectedAt: '2026-09-15T00:00:00.000Z',
      state: 'disabled',
    });
  });

  it('reads a live heartbeat and ignores extra Redis fields', async () => {
    const redis = {
      get: vi.fn(async () =>
        JSON.stringify({
          connectedAt: '2026-09-15T00:00:00.000Z',
          lastError: null,
          lastErrorAt: null,
          lastEventAt: '2026-09-15T00:00:01.000Z',
          pid: 99,
          state: 'connected',
          updatedAt: '2026-09-15T00:00:02.000Z',
        }),
      ),
    };

    await expect(
      readImConnectorStatus({ platform: 'dingtalk', redis, rowDisabled: false }),
    ).resolves.toEqual({
      connectedAt: '2026-09-15T00:00:00.000Z',
      lastError: null,
      lastErrorAt: null,
      lastEventAt: '2026-09-15T00:00:01.000Z',
      lastFrameAt: null,
      state: 'connected',
    });
  });

  it('reads lastFrameAt from a live heartbeat', async () => {
    const redis = {
      get: vi.fn(async () =>
        JSON.stringify({
          connectedAt: '2026-09-15T00:00:00.000Z',
          lastError: null,
          lastErrorAt: null,
          lastEventAt: '2026-09-15T00:00:01.000Z',
          lastFrameAt: '2026-09-15T00:00:01.500Z',
          pid: 99,
          state: 'connected',
          updatedAt: '2026-09-15T00:00:02.000Z',
        }),
      ),
    };

    await expect(
      readImConnectorStatus({ platform: 'dingtalk', redis, rowDisabled: false }),
    ).resolves.toMatchObject({
      lastFrameAt: '2026-09-15T00:00:01.500Z',
      state: 'connected',
    });
  });

  it('returns unknown when Redis JSON is malformed', async () => {
    const redis = { get: vi.fn(async () => 'not-json') };

    await expect(
      readImConnectorStatus({ platform: 'dingtalk', redis, rowDisabled: false }),
    ).resolves.toMatchObject({ state: 'unknown' });
  });
});
