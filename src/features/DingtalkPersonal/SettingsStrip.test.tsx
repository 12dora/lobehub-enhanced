// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DingtalkPersonalSettingsStrip } from './SettingsStrip';

const mocks = vi.hoisted(() => ({
  enabled: false,
  status: undefined as unknown,
  useStatus: vi.fn(),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_, key) => String(key) }),
  cssVar: new Proxy({}, { get: () => '' }),
}));

vi.mock('./capability', () => ({
  useDingtalkPersonalEnabled: () => mocks.enabled,
}));

vi.mock('./useDingtalkPersonalStatus', () => ({
  useDingtalkPersonalStatus: (enabled: boolean) => {
    mocks.useStatus(enabled);
    return { data: mocks.status };
  },
}));

vi.mock('./AuthorizeCard', () => ({
  default: ({ autoStart }: { autoStart?: boolean }) => (
    <div data-auto-start={String(Boolean(autoStart))} data-testid="authorize-card" />
  ),
}));

let currentSearch = '';
const LocationProbe = () => {
  currentSearch = useLocation().search;
  return null;
};

const renderStrip = async (entry = '/settings/connector') => {
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <DingtalkPersonalSettingsStrip>
        <div data-testid="connector-settings" />
      </DingtalkPersonalSettingsStrip>
      <LocationProbe />
    </MemoryRouter>,
  );
  // Let the effect that drops the deep-link query land.
  await act(async () => {});
  return view;
};

const card = (container: HTMLElement) =>
  container.querySelector('[data-testid="authorize-card"]') as HTMLElement | null;

const scrollIntoView = vi.fn();
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  mocks.enabled = false;
  mocks.status = undefined;
  mocks.useStatus.mockReset();
  scrollIntoView.mockReset();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  currentSearch = '';
});

afterEach(() => {
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

describe('DingtalkPersonalSettingsStrip', () => {
  it('leaves the connector page untouched while the capability is off', async () => {
    const { container } = await renderStrip();

    expect(card(container)).toBeNull();
    expect(container.firstElementChild).toBe(
      container.querySelector('[data-testid="connector-settings"]'),
    );
    // No status read for a deployment without the feature.
    expect(mocks.useStatus).toHaveBeenCalledWith(false);
  });

  it('puts the card above the page, keeping the page in a shrinkable box', async () => {
    mocks.enabled = true;
    mocks.status = { state: 'unauthorized' };
    const { container } = await renderStrip();

    const page = container.querySelector('[data-testid="connector-settings"]')!;
    expect(card(container)).toBeTruthy();
    expect(
      card(container)!.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(page.parentElement?.className).toBe('body');
    expect(page.parentElement?.parentElement?.className).toBe('shell');
    // An ordinary visit neither starts a login nor moves the page.
    expect(card(container)!.dataset.autoStart).toBe('false');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('shows the strip while the status is still loading', async () => {
    mocks.enabled = true;
    const { container } = await renderStrip();

    expect(card(container)).toBeTruthy();
  });

  it('drops the strip when the server reports the feature disabled after all', async () => {
    mocks.enabled = true;
    mocks.status = { state: 'disabled' };
    const { container } = await renderStrip();

    expect(card(container)).toBeNull();
    expect(container.firstElementChild).toBe(
      container.querySelector('[data-testid="connector-settings"]'),
    );
  });

  describe('?dingtalkPersonal=authorize deep link', () => {
    it('scrolls to the card, asks it to start the login and drops only its own query', async () => {
      mocks.enabled = true;
      const { container } = await renderStrip(
        '/settings/connector?tab=all&dingtalkPersonal=authorize',
      );

      expect(card(container)!.dataset.autoStart).toBe('true');
      expect(scrollIntoView).toHaveBeenCalled();
      // Replaced, so a reload lands on the plain page and does not start another login.
      expect(currentSearch).toBe('?tab=all');
    });

    it('works on the workspace connector route too', async () => {
      mocks.enabled = true;
      const { container } = await renderStrip(
        '/acme/settings/connector?dingtalkPersonal=authorize',
      );

      expect(card(container)!.dataset.autoStart).toBe('true');
      expect(currentSearch).toBe('');
    });

    it('ignores other values of the query', async () => {
      mocks.enabled = true;
      const { container } = await renderStrip('/settings/connector?dingtalkPersonal=open');

      expect(card(container)!.dataset.autoStart).toBe('false');
      expect(currentSearch).toBe('?dingtalkPersonal=open');
    });

    it('still clears the query when the capability is off', async () => {
      const { container } = await renderStrip('/settings/connector?dingtalkPersonal=authorize');

      expect(card(container)).toBeNull();
      expect(currentSearch).toBe('');
    });
  });
});
