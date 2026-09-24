import type { AppLinkResolver } from '@lobechat/utils/appLink';
import { APP_LINK_PATHS, markdownLink } from '@lobechat/utils/appLink';

/**
 * Model-facing copy for a disabled tool. Each variant names the one page where the tool is switched
 * back on as a plain markdown link, so the model can hand the user a one-click way there.
 *
 * `resolveLink` makes the path absolute (and DingTalk-SSO wrapped) for IM surfaces; the default
 * keeps the app-relative path, which the web chat routes inside the SPA.
 */
const identity: AppLinkResolver = (path) => path;

const userLink = (resolveLink: AppLinkResolver) =>
  markdownLink('设置 → 连接器', resolveLink(APP_LINK_PATHS.connectors));

const orgLink = (resolveLink: AppLinkResolver) =>
  markdownLink('管理后台 → 连接器', resolveLink(APP_LINK_PATHS.adminConnectors));

/** Manifest description of a tool the user switched off. */
export const userDisabledToolDescription = (
  toolName: string,
  resolveLink: AppLinkResolver = identity,
): string =>
  `[TOOL DISABLED] The user has disabled this tool and it cannot be executed. ` +
  `Do NOT call this tool. If the user asks to perform this action, inform them ` +
  `that they have manually disabled "${toolName}" and can re-enable it in ` +
  `${userLink(resolveLink)} (include this link).`;

/** Manifest description of a builtin tool the org connector policy switched off. */
export const orgDisabledToolDescription = (
  toolName: string,
  resolveLink: AppLinkResolver = identity,
): string =>
  `[TOOL DISABLED] This tool has been disabled by your organization's connector policy ` +
  `and cannot be executed. Do NOT call this tool. If the user asks to perform this action, ` +
  `inform them that "${toolName}" is disabled by organization policy and only an ` +
  `administrator can re-enable it in ${orgLink(resolveLink)} (include this link).`;

/** Tool result when a disabled tool is called anyway. */
export const blockedToolMessage = (
  toolName: string,
  options: { byOrgPolicy?: boolean; resolveLink?: AppLinkResolver } = {},
): string => {
  const resolveLink = options.resolveLink ?? identity;

  return options.byOrgPolicy
    ? `The tool "${toolName}" has been disabled by your organization's connector policy and ` +
        `cannot be executed. Please inform the user that only an administrator can re-enable it ` +
        `in ${orgLink(resolveLink)}.`
    : `The tool "${toolName}" has been disabled by the user and cannot be executed. ` +
        `Please inform the user that this tool is currently disabled and can be re-enabled in ` +
        `${userLink(resolveLink)}.`;
};
