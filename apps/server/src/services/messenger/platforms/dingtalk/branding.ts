import { BUILT_IN_RUNTIME_BRANDING } from '@lobechat/business-const';
import debug from 'debug';

import { resolveServerRuntimeBranding } from '@/server/enterprise/services/branding/runtimeBranding';

import { DINGTALK_BRANDING_FALLBACK } from './const';

const log = debug('lobe-server:messenger:dingtalk:branding');

const normalizeBrandingName = (name: string): string => name.replaceAll(/\s+/g, '').toLowerCase();

/** Built-in product names (runtime branding off / unpublished snapshot). */
const BUILT_IN_BRANDING_NAME_KEYS = new Set(
  [BUILT_IN_RUNTIME_BRANDING.name, 'LobeHub', 'LobeChat', 'AIHub'].map(normalizeBrandingName),
);

const isBuiltInBrandingName = (name: string): boolean =>
  BUILT_IN_BRANDING_NAME_KEYS.has(normalizeBrandingName(name));

/**
 * Published platform branding display name (`platform_branding.display_name` →
 * `RuntimeBranding.name`). Empty, built-in (LobeHub / LobeChat / AIHub), or
 * failed reads fall back to 「AI 助手」. This is the SITE name, used in
 * "login on the web" / "view in …" copy — not the DingTalk robot's name.
 */
export const resolveDingTalkBrandingDisplayName = async (): Promise<string> => {
  try {
    const branding = await resolveServerRuntimeBranding();
    const name = branding.name?.trim();
    if (!name || isBuiltInBrandingName(name)) return DINGTALK_BRANDING_FALLBACK;
    return name;
  } catch (error) {
    log('resolveServerRuntimeBranding failed: %O', error);
    return DINGTALK_BRANDING_FALLBACK;
  }
};

/**
 * Name of the DingTalk chat robot as shown to employees ("find the robot
 * 「…」 in DingTalk"). Prefers connector setting `robotDisplayName`; empty
 * falls back to `DINGTALK_BRANDING_FALLBACK` (「AI 助手」), never the site
 * branding name.
 */
export const resolveDingTalkRobotDisplayName = (stored?: string | null): string => {
  return stored?.trim() || DINGTALK_BRANDING_FALLBACK;
};
