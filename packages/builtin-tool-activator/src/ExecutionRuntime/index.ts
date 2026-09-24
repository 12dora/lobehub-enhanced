import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { APP_LINK_PATHS, type AppLinkResolver, linkedPath } from '@lobechat/utils/appLink';

import type { ActivatedToolInfo, ActivateSkillParams, ActivateToolsParams } from '../types';

export interface ToolManifestInfo {
  apiDescriptions: Array<{ description: string; name: string }>;
  avatar?: string;
  identifier: string;
  name: string;
  systemRole?: string;
}

/** Device-gated builtin. Activation requires a routed desktop. */
export const LOCAL_SYSTEM_IDENTIFIER = 'lobe-local-system';

const deviceLinks = (resolveLink?: AppLinkResolver) => ({
  devices: linkedPath(resolveLink, '设备页', APP_LINK_PATHS.devices),
  downloads: linkedPath(resolveLink, '下载桌面端', APP_LINK_PATHS.downloads),
});

/** Shown when `lobe-local-system` is requested and this run has no active device. */
export const localSystemNoDeviceMessage = (resolveLink?: AppLinkResolver): string => {
  const { devices, downloads } = deviceLinks(resolveLink);
  return `当前没有在线的桌面设备，本地系统工具不可用。请${downloads}并在${devices}连接。`;
};

/** Online desktops exist, but this run has not selected one yet. */
export const localSystemAwaitingDeviceMessage = (resolveLink?: AppLinkResolver): string => {
  const { devices } = deviceLinks(resolveLink);
  return `有在线设备但尚未选择，请先用远程设备工具选择一台设备，或打开${devices}查看。`;
};

export const LOCAL_SYSTEM_NO_DEVICE_MESSAGE = localSystemNoDeviceMessage();

export interface ActivatorRuntimeService {
  activateSkill?: (args: ActivateSkillParams) => Promise<BuiltinServerRuntimeOutput>;
  getActivatedToolIds: () => string[];
  getToolManifests: (identifiers: string[]) => Promise<ToolManifestInfo[]>;
  /**
   * Whether this run has a routed desktop.
   *
   * `false` refuses `lobe-local-system` (no device to run it, and the prompt
   * would keep unreplaced `{{hostname}}` / `{{workingDirectory}}` placeholders).
   * Omit on the desktop client, where the machine itself is the device.
   */
  hasActiveDevice?: () => boolean;
  markActivated: (identifiers: string[]) => void;
}

export interface ActivatorExecutionRuntimeOptions {
  resolveLink?: AppLinkResolver;
  service: ActivatorRuntimeService;
}

export class ActivatorExecutionRuntime {
  private noDeviceMessage: string;
  private service: ActivatorRuntimeService;

  constructor(options: ActivatorExecutionRuntimeOptions) {
    this.service = options.service;
    this.noDeviceMessage = localSystemNoDeviceMessage(options.resolveLink);
  }

  async activateSkill(args: ActivateSkillParams): Promise<BuiltinServerRuntimeOutput> {
    if (!this.service.activateSkill) {
      return {
        content: 'Skill activation is not available.',
        success: false,
      };
    }

    return this.service.activateSkill(args);
  }

  async activateTools(args: ActivateToolsParams): Promise<BuiltinServerRuntimeOutput> {
    const { identifiers } = args;

    if (!identifiers || identifiers.length === 0) {
      return {
        content: 'No tool identifiers provided. Please specify which tools to activate.',
        success: false,
      };
    }

    try {
      const alreadyActive = this.service.getActivatedToolIds();
      const toActivate: string[] = [];
      const alreadyActiveList: string[] = [];
      // Explicit activation bypasses AgentToolsEngine's local-system rule
      // (online + auto-activated device). Refuse here when the run has no device.
      const deviceUnavailable: string[] = [];
      const localSystemBlocked =
        this.service.hasActiveDevice !== undefined && !this.service.hasActiveDevice();

      for (const id of identifiers) {
        if (id === LOCAL_SYSTEM_IDENTIFIER && localSystemBlocked) {
          deviceUnavailable.push(id);
          continue;
        }
        if (alreadyActive.includes(id)) {
          alreadyActiveList.push(id);
        } else {
          toActivate.push(id);
        }
      }

      // Fetch manifests for tools to activate
      const manifests = await this.service.getToolManifests(toActivate);

      const foundIdentifiers = new Set(manifests.map((m) => m.identifier));
      const notFoundAsTools = toActivate.filter((id) => !foundIdentifiers.has(id));

      // Fallback: try activating not-found identifiers as skills
      const activatedSkillResults: BuiltinServerRuntimeOutput[] = [];
      const notFound: string[] = [];

      if (notFoundAsTools.length > 0 && this.service.activateSkill) {
        for (const id of notFoundAsTools) {
          try {
            const skillResult = await this.service.activateSkill({ name: id });
            if (skillResult.success) {
              activatedSkillResults.push(skillResult);
            } else {
              notFound.push(id);
            }
          } catch {
            notFound.push(id);
          }
        }
      } else {
        notFound.push(...notFoundAsTools);
      }

      const activatedTools: ActivatedToolInfo[] = manifests.map((m) => ({
        apiCount: m.apiDescriptions.length,
        avatar: m.avatar,
        identifier: m.identifier,
        name: m.name,
      }));

      // Mark newly activated tools
      if (manifests.length > 0) {
        this.service.markActivated(manifests.map((m) => m.identifier));
      }

      // Build response content
      const parts: string[] = [];

      if (activatedTools.length > 0) {
        parts.push('Successfully activated tools:');
        for (const manifest of manifests) {
          parts.push(`\n## ${manifest.name} (${manifest.identifier})`);
          if (manifest.systemRole) {
            parts.push(manifest.systemRole);
          }
          if (manifest.apiDescriptions.length > 0) {
            parts.push('\nAvailable APIs:');
            for (const api of manifest.apiDescriptions) {
              parts.push(`- **${api.name}**: ${api.description}`);
            }
          }
        }
      }

      if (activatedSkillResults.length > 0) {
        for (const skillResult of activatedSkillResults) {
          parts.push(skillResult.content);
        }
      }

      if (alreadyActiveList.length > 0) {
        parts.push(`\nAlready active: ${alreadyActiveList.join(', ')}`);
      }

      if (deviceUnavailable.length > 0) {
        notFound.push(...deviceUnavailable);
        parts.push(`\n${this.noDeviceMessage}`);
      }

      if (notFound.length > 0) {
        const otherNotFound = notFound.filter((id) => !deviceUnavailable.includes(id));
        if (otherNotFound.length > 0) {
          parts.push(`\nNot found: ${otherNotFound.join(', ')}`);
        }
      }

      return {
        content: parts.join('\n'),
        state: {
          activatedSkills: activatedSkillResults.map((r) => r.state),
          activatedTools,
          alreadyActive: alreadyActiveList,
          notFound,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to activate tools: ${(e as Error).message}`,
        success: false,
      };
    }
  }
}
