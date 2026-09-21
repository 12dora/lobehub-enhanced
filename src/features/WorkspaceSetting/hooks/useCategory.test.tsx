import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceSettingsTabs } from '@/types/workspaceSettings';

import { useWorkspaceSettingCategory } from './useCategory';

const managedResourcesRef = vi.hoisted(() => ({
  current: {
    capabilities: {
      agents: false,
      aiModels: false,
      aiProviders: false,
      connectors: false,
      skills: false,
    },
    error: null as Error | null,
    loading: false,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/business/client/hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => true,
}));

vi.mock('@/business/client/hooks/useShowWorkspaceApiKey', () => ({
  useShowWorkspaceApiKey: () => true,
}));

vi.mock('@/features/ManagedResources', () => ({
  isManagedResourceConfigurationAvailable: (
    resource: keyof typeof managedResourcesRef.current.capabilities,
    snapshot: typeof managedResourcesRef.current,
  ) => !snapshot.loading && !snapshot.error && !snapshot.capabilities[resource],
  useManagedResourceCapabilities: () => managedResourcesRef.current,
}));

const getItemKeys = () => {
  const { result } = renderHook(() => useWorkspaceSettingCategory());
  return result.current.flatMap((group) => group.items.map((item) => item.key));
};

afterEach(() => {
  managedResourcesRef.current = {
    capabilities: {
      agents: false,
      aiModels: false,
      aiProviders: false,
      connectors: false,
      skills: false,
    },
    error: null,
    loading: false,
  };
});

describe('workspace settings useCategory', () => {
  it('lists Skill and Connector when nothing is platform-managed', () => {
    const keys = getItemKeys();

    expect(keys).toContain(WorkspaceSettingsTabs.Skill);
    expect(keys).toContain(WorkspaceSettingsTabs.Connector);
  });

  it('hides Skill when skills are platform-managed', () => {
    managedResourcesRef.current.capabilities.skills = true;

    expect(getItemKeys()).not.toContain(WorkspaceSettingsTabs.Skill);
  });

  // Managed connectors still need each user to authorize their own OAuth
  // accounts, so the entry stays and the route picks the surface.
  it('keeps Connector when connectors are platform-managed', () => {
    managedResourcesRef.current.capabilities.connectors = true;

    expect(getItemKeys()).toContain(WorkspaceSettingsTabs.Connector);
  });

  it('keeps Connector while the capability snapshot is unavailable', () => {
    managedResourcesRef.current.loading = true;

    expect(getItemKeys()).toContain(WorkspaceSettingsTabs.Connector);
    expect(getItemKeys()).not.toContain(WorkspaceSettingsTabs.Skill);
  });
});
