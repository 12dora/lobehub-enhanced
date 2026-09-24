/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DingTalkLinkBody from './DingTalk';

const mocks = vi.hoisted(() => ({ close: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  useModalContext: () => ({ close: mocks.close }),
}));

vi.mock('../constants', () => ({
  PlatformAvatar: () => <span data-testid="platform-avatar" />,
}));

afterEach(() => {
  cleanup();
  mocks.close.mockReset();
});

describe('DingTalkLinkBody', () => {
  it('links the admin IM connector tab when chat is off, and closes the modal on the way', () => {
    render(
      <MemoryRouter>
        <DingTalkLinkBody chatDisabled name={'钉钉'} />
      </MemoryRouter>,
    );

    expect(screen.getByText('messenger.dingtalk.capabilities.chatDisabled')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'messenger.dingtalk.capabilities.adminLink' });
    expect(link.getAttribute('href')).toBe('/admin/system/general?tab=im-connectors');

    fireEvent.click(link);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('only gives the bind instruction while chat is on', () => {
    render(<DingTalkLinkBody name={'钉钉'} />);

    expect(screen.getByText('messenger.dingtalk.status.instructions')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
