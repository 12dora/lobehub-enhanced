import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import SettingsContent from './SettingsContent';

vi.mock('./componentMap', () => ({
  componentMap: {
    [SettingsTabs.Connector]: () => <div data-testid="connector-page" />,
    [SettingsTabs.Skill]: () => <div data-testid="skill-page" />,
  },
}));

vi.mock('@/features/ManagedResources', () => ({
  getManagedResourceForSettingsTab: (tab: string) =>
    tab === SettingsTabs.Connector
      ? 'connectors'
      : tab === SettingsTabs.Skill
        ? 'skills'
        : undefined,
  ManagedResourceBoundary: ({ children, resource }: { children: ReactNode; resource: string }) => (
    <div data-resource={resource} data-testid="managed-boundary">
      {children}
    </div>
  ),
}));

vi.mock('@/features/NavHeader', () => ({ default: () => <div /> }));

vi.mock('@/features/Setting/SettingContainer', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableBusinessFeatures: () => false },
  useServerConfigStore: () => false,
}));

describe('SettingsContent managed-resource boundary', () => {
  /**
   * Managed connectors still need each user to authorize their own OAuth
   * accounts, and the connector route already switches surfaces itself — so a
   * deep link must not be replaced by the "managed by your organization" notice.
   */
  it('does not wrap the Connector tab in the managed boundary', () => {
    const { queryByTestId } = render(<SettingsContent activeTab={SettingsTabs.Connector} />);

    expect(queryByTestId('connector-page')).toBeTruthy();
    expect(queryByTestId('managed-boundary')).toBeNull();
  });

  it('still wraps other managed tabs', () => {
    const { getByTestId } = render(<SettingsContent activeTab={SettingsTabs.Skill} />);

    expect(getByTestId('managed-boundary').dataset.resource).toBe('skills');
    expect(getByTestId('skill-page')).toBeTruthy();
  });
});
