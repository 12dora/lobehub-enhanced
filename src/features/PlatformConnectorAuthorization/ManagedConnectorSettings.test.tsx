import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ManagedConnectorSettings from './ManagedConnectorSettings';
import type { ManagedConnector } from './types';

const useManagedResource = vi.fn();
const useFetchManagedConnectors = vi.fn();

vi.mock('@/features/ManagedResources', () => ({
  ManagedResourceTransition: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useManagedResource: (...args: unknown[]) => useManagedResource(...args),
}));

vi.mock('./PlatformConnectorAuthorization', () => ({
  default: () => <div data-testid="platform-connectors" />,
}));

vi.mock('./useManagedConnectors', () => ({
  useFetchManagedConnectors: (...args: unknown[]) => useFetchManagedConnectors(...args),
}));

vi.mock('./useConnectorAuthorizationActions', () => ({
  useConnectorAuthorizationActions: () => ({
    authorize: vi.fn(),
    busyAction: null,
    busyConnectorId: null,
    cancelAuthorization: vi.fn(),
    disconnect: vi.fn(),
    feedback: null,
  }),
}));

vi.mock('./ConnectorCard', () => ({
  default: ({ connector }: { connector: ManagedConnector }) => (
    <div data-testid={`org-connector-${connector.id}`} />
  ),
}));

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/settings/connector' }),
}));

const publishedConnector = {
  displayName: 'Jira',
  id: 'c1',
  tools: [],
} as unknown as ManagedConnector;

beforeEach(() => {
  useFetchManagedConnectors.mockReturnValue({ data: undefined });
});

/**
 * The platform-managed connector page is a document-flow list, not the
 * master-detail catalog the unmanaged fallback renders, so it needs its own
 * scroller — the settings pane around it is `overflow: hidden`.
 */
describe('ManagedConnectorSettings', () => {
  it('renders the managed authorization list inside a scroller', () => {
    useManagedResource.mockReturnValue({
      error: undefined,
      loading: false,
      managed: true,
      refresh: vi.fn(),
    });

    const { container } = render(<ManagedConnectorSettings fallback={null} />);

    const list = container.querySelector('[data-testid="platform-connectors"]')!;
    const scroller = list.closest('[style*="overflow-y: auto"]') as HTMLElement;
    expect(scroller).toBeTruthy();
    expect(scroller.style.minHeight).toBe('0');
  });

  it('leaves the unmanaged catalog fallback full-bleed', () => {
    useManagedResource.mockReturnValue({
      error: undefined,
      loading: false,
      managed: false,
      refresh: vi.fn(),
    });

    const { container } = render(
      <ManagedConnectorSettings fallback={<div data-testid="tool-settings" />} />,
    );

    const fallback = container.querySelector('[data-testid="tool-settings"]')!;
    expect(fallback.closest('[style*="overflow-y: auto"]')).toBeNull();
  });

  describe('unmanaged deployments with a published org catalog', () => {
    beforeEach(() => {
      useManagedResource.mockReturnValue({
        error: undefined,
        loading: false,
        managed: false,
        refresh: vi.fn(),
      });
    });

    it('adds no wrapper around the fallback while nothing is published', () => {
      useFetchManagedConnectors.mockReturnValue({ data: { items: [], nextCursor: null } });

      const { container } = render(
        <ManagedConnectorSettings fallback={<div data-testid="tool-settings" />} />,
      );

      expect(container.querySelector('[data-testid="org-connector-c1"]')).toBeNull();
      expect(container.firstElementChild).toBe(
        container.querySelector('[data-testid="tool-settings"]'),
      );
    });

    it('adds no wrapper around the fallback when the org list cannot be read', () => {
      useFetchManagedConnectors.mockReturnValue({ data: undefined, error: new Error('nope') });

      const { container } = render(
        <ManagedConnectorSettings fallback={<div data-testid="tool-settings" />} />,
      );

      expect(container.firstElementChild).toBe(
        container.querySelector('[data-testid="tool-settings"]'),
      );
    });

    it('surfaces published org connectors above the catalog without breaking it', () => {
      useFetchManagedConnectors.mockReturnValue({
        data: { items: [publishedConnector], nextCursor: null },
      });

      const { container } = render(
        <ManagedConnectorSettings fallback={<div data-testid="tool-settings" />} />,
      );

      const card = container.querySelector('[data-testid="org-connector-c1"]')!;
      const fallback = container.querySelector('[data-testid="tool-settings"]')!;
      expect(card).toBeTruthy();

      // Strip first, catalog after it, and the catalog box keeps a shrinkable
      // flex chain so the master-detail panes still scroll.
      expect(
        card.compareDocumentPosition(fallback) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const catalogBox = fallback.parentElement!;
      expect(getComputedStyle(catalogBox).minHeight).toBe('0');
      expect(getComputedStyle(catalogBox.parentElement!).height).toBe('100%');
    });
  });
});
