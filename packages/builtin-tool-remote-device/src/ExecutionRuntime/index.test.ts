import { describe, expect, it, vi } from 'vitest';

import { RemoteDeviceExecutionRuntime } from './index';
import type { DeviceAttachment } from './types';

const offline = (deviceId: string): DeviceAttachment => ({
  deviceId,
  hostname: 'mac',
  lastSeen: '2026-01-01T00:00:00.000Z',
  online: false,
  platform: 'darwin',
});

describe('RemoteDeviceExecutionRuntime.listOnlineDevices', () => {
  it('asks the user to download and connect when nothing is online', async () => {
    const runtime = new RemoteDeviceExecutionRuntime({
      queryDeviceList: vi.fn().mockResolvedValue([offline('d1')]),
    });

    const result = await runtime.listOnlineDevices();

    expect(result.success).toBe(true);
    expect(result.content).toContain('[下载桌面端](/downloads)');
    expect(result.content).toContain('[设备页](/settings/devices)');
  });

  it('uses the injected resolver for the surface showing the result', async () => {
    const runtime = new RemoteDeviceExecutionRuntime(
      { queryDeviceList: vi.fn().mockResolvedValue([]) },
      { resolveLink: (path) => `https://chat.example${path}` },
    );

    const result = await runtime.listOnlineDevices();

    expect(result.content).toContain('[下载桌面端](https://chat.example/downloads)');
    expect(result.content).toContain('[设备页](https://chat.example/settings/devices)');
  });
});
