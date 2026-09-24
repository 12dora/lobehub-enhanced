/**
 * Direct links for "the user has to do something by hand" messages.
 *
 * Every tool result / bot message that asks a person to switch something on,
 * authorize, bind or configure must carry a one-click link to the exact page.
 * Web chats render app-relative paths inside the SPA; DingTalk (and other IM)
 * bubbles need an absolute URL, and inside DingTalk the link should go through
 * `/dingtalk/sso` so the in-app browser signs the user in first.
 */

/** AIHub pages that a manual-action message may point at. */
export const APP_LINK_PATHS = {
  /** Admin: DingTalk IM connector (chat/push/workspace/personal-data switches, CorpId, notify app). */
  adminImConnectors: '/admin/system/general?tab=im-connectors',
  /** Admin: platform-managed connectors. */
  adminConnectors: '/admin/ai/connectors',
  /** Admin: infrastructure card (enterprise lookup, sandbox …). */
  adminSystemGeneral: '/admin/system/general',
  /** Admin: platform skills. */
  adminSkills: '/admin/skills',
  /** Admin: service models (embedding, system agent). */
  adminServiceModel: '/admin/ai/service-model',
  /** User: approval automation rules. */
  approvalRules: '/settings/approval-rules',
  /** User: connectors list (MCP / builtin tool switches, DingTalk personal-data card). */
  connectors: '/settings/connector',
  /** User: credit balance / top-up. */
  credits: '/settings/credits',
  /** User: desktop devices (connect wizard). */
  devices: '/settings/devices',
  /** User: DingTalk binding status / instructions. */
  dingtalkBinding: '/settings/messenger/dingtalk',
  /** User: authorize DingTalk personal data — the page auto-starts the device login. */
  dingtalkPersonalAuthorize: '/settings/connector?dingtalkPersonal=authorize',
  /** User: desktop app download. */
  downloads: '/downloads',
  /** User: messenger integrations list. `/settings/messenger/<platform>` is the detail page. */
  messenger: '/settings/messenger',
  /** User: notification channels. */
  notification: '/settings/notification',
  /** User: subscription plans. */
  plans: '/settings/plans',
  /** User: all AI providers. */
  providers: '/settings/provider/all',
  /** User: skills / integrations (Composio, LobeHub skills OAuth cards). */
  skills: '/settings/skill',
} as const;

export type AppLinkPathKey = keyof typeof APP_LINK_PATHS;

/** DingTalk consoles an org admin must use (no AIHub page can do these). */
export const DINGTALK_CONSOLE_LINKS = {
  /** 开发者后台 → 基本信息 → CLI 设置（「允许成员通过 CLI 访问个人数据」）; URL printed by the official dws CLI. */
  cliSettings: 'https://open-dev.dingtalk.com/fe/old#/developerSettings',
  /** 钉钉开发者后台首页（应用权限、机器人等）. */
  developerConsole: 'https://open-dev.dingtalk.com/',
  /** 钉钉管理后台（通讯录、OA 审批管理员等）. */
  oaAdmin: 'https://oa.dingtalk.com/',
} as const;

/** Path of the DingTalk in-app sign-in bridge; `?redirect=` is an app-relative path. */
export const DINGTALK_SSO_PATH = '/dingtalk/sso';

/** `https://host/` → `https://host`; blank → ''. */
export const normalizeAppOrigin = (origin?: string | null): string =>
  (origin ?? '').trim().replace(/\/+$/, '');

const isAbsoluteHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/** Only app-relative paths (`/x`, not `//host`, not `/\host`) can be joined to the origin. */
const isAppPath = (value: string): boolean =>
  value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');

/**
 * Join an app-relative path to the app origin. Absolute http(s) URLs pass through.
 * With a blank origin the path stays relative (fine for the web SPA, not for IM).
 */
export const buildAppUrl = (origin: string | null | undefined, path: string): string => {
  const target = path.trim();
  if (isAbsoluteHttpUrl(target)) return target;
  if (!isAppPath(target)) return target;
  const base = normalizeAppOrigin(origin);
  return base ? `${base}${target}` : target;
};

/**
 * Link for a DingTalk bubble: goes through `/dingtalk/sso` so the DingTalk in-app
 * browser signs the user in, then lands on `path`. External URLs pass through.
 */
export const buildDingTalkAppUrl = (origin: string | null | undefined, path: string): string => {
  const target = path.trim();
  if (isAbsoluteHttpUrl(target) || !isAppPath(target)) return target;
  const wrapped = target.startsWith(`${DINGTALK_SSO_PATH}?`)
    ? target
    : `${DINGTALK_SSO_PATH}?redirect=${encodeURIComponent(target)}`;
  return buildAppUrl(origin, wrapped);
};

export interface AppLinkContext {
  /** `appEnv.APP_URL` on the server; empty in the browser (relative links stay in the SPA). */
  origin?: string | null;
  /** `'dingtalk'` when the message is shown in a DingTalk chat. */
  platform?: string | null;
}

/** Resolve an app path for the surface the message will be shown on. */
export const resolveAppLink = (ctx: AppLinkContext, path: string): string =>
  ctx.platform === 'dingtalk'
    ? buildDingTalkAppUrl(ctx.origin, path)
    : buildAppUrl(ctx.origin, path);

/** `[label](url)` — plain markdown (DingTalk markdown does not support `<url>` destinations). */
export const markdownLink = (label: string, url: string): string => `[${label}](${url})`;

/** Resolver injected into tool runtimes that build user-facing copy. Identity by default. */
export type AppLinkResolver = (path: string) => string;

const identityAppLink: AppLinkResolver = (path) => path;

/**
 * `[label](resolved path)`. With no resolver the path stays app-relative,
 * which the web SPA renders as an in-app link.
 */
export const linkedPath = (
  resolveLink: AppLinkResolver | undefined,
  label: string,
  path: string,
): string => markdownLink(label, (resolveLink ?? identityAppLink)(path));

/**
 * Where an unbound user signs in.
 * Web → messenger binding page. DingTalk → SSO bridge to `/` (in-app sign-in completes the binding).
 */
export const identitySignInPath = (platform?: string | null): string =>
  platform === 'dingtalk' ? '/' : APP_LINK_PATHS.dingtalkBinding;

/** UNBOUND / UNVERIFIED copy. `resolveLink` already knows the surface. */
export const dingtalkIdentityGuidance = (
  resolveLink: AppLinkResolver | undefined,
  platform?: string | null,
): string =>
  `请先用钉钉登录 AIHub（${linkedPath(resolveLink, '用钉钉登录', identitySignInPath(platform))}），或在钉钉里给机器人发一条消息完成绑定`;

export const imConnectorAdminLink = (resolveLink?: AppLinkResolver): string =>
  linkedPath(resolveLink, 'IM 连接器设置', APP_LINK_PATHS.adminImConnectors);

/** Appended to an admin-only instruction shown to an end user. */
export const adminEntrySuffix = (resolveLink?: AppLinkResolver): string =>
  `（管理员入口：${imConnectorAdminLink(resolveLink)}）`;

export const oaAdminMarkdownLink = (): string =>
  markdownLink('钉钉管理后台', DINGTALK_CONSOLE_LINKS.oaAdmin);

export const cliSettingsMarkdownLink = (): string =>
  markdownLink('CLI 设置', DINGTALK_CONSOLE_LINKS.cliSettings);

export const createAppLinkResolver =
  (ctx: AppLinkContext): AppLinkResolver =>
  (path: string) =>
    resolveAppLink(ctx, path);
