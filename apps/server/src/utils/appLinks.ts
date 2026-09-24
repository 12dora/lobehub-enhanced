import {
  APP_LINK_PATHS,
  type AppLinkResolver,
  createAppLinkResolver,
  linkedPath,
  resolveAppLink,
} from '@lobechat/utils/appLink';

import { appEnv } from '@/envs/app';

/**
 * Server-side app links for manual-action messages (see `@lobechat/utils/appLink`).
 * `platform === 'dingtalk'` wraps the path in the DingTalk SSO bridge.
 */
export const serverAppLink = (path: string, platform?: string | null): string =>
  resolveAppLink({ origin: appEnv.APP_URL, platform }, path);

export const serverAppLinkResolver = (platform?: string | null): AppLinkResolver =>
  createAppLinkResolver({ origin: appEnv.APP_URL, platform });

const link = (label: string, path: string, platform?: string | null): string =>
  linkedPath(serverAppLinkResolver(platform), label, path);

/** Stdio / desktop-only integration cannot run on the cloud server. */
export const desktopDeviceRequiredMessage = (platform?: string | null): string => {
  const devices = link('设备页', APP_LINK_PATHS.devices, platform);
  const downloads = link('下载桌面端', APP_LINK_PATHS.downloads, platform);
  return `此集成需要在已连接的桌面设备上运行。请打开${devices}连接，或先${downloads}。`;
};

/** Tool was hard-blocked. Org policy points at the admin page; a user switch points at settings. */
export const blockedConnectorToolMessage = (
  toolName: string,
  options: { governed: boolean; platform?: string | null },
): string => {
  if (options.governed) {
    const admin = link('连接器管理', APP_LINK_PATHS.adminConnectors, options.platform);
    return `工具「${toolName}」已被组织策略关闭，只有管理员可以重新开启。请联系管理员（管理员入口：${admin}）。`;
  }
  const settings = link('连接器设置', APP_LINK_PATHS.connectors, options.platform);
  return `工具「${toolName}」已被关闭，无法执行。请到${settings}重新开启。`;
};

export const managedSkillRunFailedMessage = (platform?: string | null): string => {
  const admin = link('技能管理', APP_LINK_PATHS.adminSkills, platform);
  return `这个技能这次没跑成。请重新开一轮再试；如果还是不行，请联系管理员（管理员入口：${admin}）。`;
};

export const managedSkillUnavailableMessage = (platform?: string | null): string => {
  const admin = link('技能管理', APP_LINK_PATHS.adminSkills, platform);
  return `这个技能已经不可用。请重新开一轮，或请管理员重新发布（管理员入口：${admin}）。`;
};
