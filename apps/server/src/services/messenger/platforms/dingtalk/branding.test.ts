import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/enterprise/services/branding/runtimeBranding', () => ({
  resolveServerRuntimeBranding: vi.fn(),
}));

const { resolveServerRuntimeBranding } =
  await import('@/server/enterprise/services/branding/runtimeBranding');
const { resolveDingTalkBrandingDisplayName } = await import('./branding');
const { DINGTALK_BRANDING_FALLBACK } = await import('./const');

describe('resolveDingTalkBrandingDisplayName', () => {
  it('returns the published branding name', async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: 'AI平台' } as any);
    expect(await resolveDingTalkBrandingDisplayName()).toBe('AI平台');
  });

  it('falls back when the published name is empty', async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: '  ' } as any);
    expect(await resolveDingTalkBrandingDisplayName()).toBe(DINGTALK_BRANDING_FALLBACK);
  });

  it('falls back when the name is the built-in LobeHub default', async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: 'LobeHub' } as any);
    expect(await resolveDingTalkBrandingDisplayName()).toBe(DINGTALK_BRANDING_FALLBACK);
  });

  it('falls back when the name is LobeChat', async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: 'LobeChat' } as any);
    expect(await resolveDingTalkBrandingDisplayName()).toBe(DINGTALK_BRANDING_FALLBACK);
  });

  it('falls back when the name is AIHub', async () => {
    vi.mocked(resolveServerRuntimeBranding).mockResolvedValueOnce({ name: 'AIHub' } as any);
    expect(await resolveDingTalkBrandingDisplayName()).toBe(DINGTALK_BRANDING_FALLBACK);
  });

  it('falls back when branding resolution throws', async () => {
    vi.mocked(resolveServerRuntimeBranding).mockRejectedValueOnce(new Error('offline'));
    expect(await resolveDingTalkBrandingDisplayName()).toBe(DINGTALK_BRANDING_FALLBACK);
  });
});
