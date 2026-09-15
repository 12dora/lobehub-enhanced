import { resolveServerRuntimeBranding } from '@/server/enterprise/services/branding/runtimeBranding';

import { DINGTALK_BRANDING_FALLBACK } from './const';

/**
 * Published platform branding display name (`platform_branding.display_name` →
 * `RuntimeBranding.name`). Empty / failed reads fall back to 「AI 平台」.
 */
export const resolveDingTalkBrandingDisplayName = async (): Promise<string> => {
  try {
    const branding = await resolveServerRuntimeBranding();
    const name = branding.name?.trim();
    return name || DINGTALK_BRANDING_FALLBACK;
  } catch {
    return DINGTALK_BRANDING_FALLBACK;
  }
};
