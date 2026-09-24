import { type BuiltinServerRuntimeOutput } from '@lobechat/types';
import { APP_LINK_PATHS, type AppLinkResolver, linkedPath } from '@lobechat/utils/appLink';

import { type DeviceAttachment } from './types';

export interface RemoteDeviceRuntimeService {
  queryDeviceList: () => Promise<DeviceAttachment[]>;
}

export class RemoteDeviceExecutionRuntime {
  private resolveLink?: AppLinkResolver;
  private service: RemoteDeviceRuntimeService;

  constructor(service: RemoteDeviceRuntimeService, options?: { resolveLink?: AppLinkResolver }) {
    this.service = service;
    this.resolveLink = options?.resolveLink;
  }

  async listOnlineDevices(): Promise<BuiltinServerRuntimeOutput> {
    try {
      const devices = await this.service.queryDeviceList();
      const onlineDevices = devices.filter((d) => d.online);

      return {
        content:
          onlineDevices.length > 0
            ? JSON.stringify(onlineDevices)
            : `没有在线的桌面设备。请先${linkedPath(this.resolveLink, '下载桌面端', APP_LINK_PATHS.downloads)}，再在${linkedPath(this.resolveLink, '设备页', APP_LINK_PATHS.devices)}连接。`,
        state: { devices: onlineDevices },
        success: true,
      };
    } catch (error) {
      return {
        content: `Failed to list devices: ${error instanceof Error ? error.message : String(error)}`,
        error,
        success: false,
      };
    }
  }

  async activateDevice(args: { deviceId: string }): Promise<BuiltinServerRuntimeOutput> {
    try {
      const devices = await this.service.queryDeviceList();
      const target = devices.find((d) => d.deviceId === args.deviceId && d.online);

      if (!target) {
        return {
          content: `Device "${args.deviceId}" is not online or does not exist.`,
          success: false,
        };
      }

      return {
        content: `Device "${target.friendlyName || target.hostname}" (${target.platform}) activated successfully. Local System tools are now available.`,
        state: {
          activatedDevice: target,
          metadata: { activeDeviceId: args.deviceId },
        },
        success: true,
      };
    } catch (error) {
      return {
        content: `Failed to activate device: ${error instanceof Error ? error.message : String(error)}`,
        error,
        success: false,
      };
    }
  }
}
