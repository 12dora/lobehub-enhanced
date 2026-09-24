/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import zhPlugin from '../../../../../locales/zh-CN/plugin.json';
import ErrorNotice from './ErrorNotice';

const dict = zhPlugin as Record<string, string>;

/** Real zh-CN copy, so a renamed or missing key fails here instead of shipping. */
const translate = (key: string) => {
  const raw = dict[key];
  if (raw === undefined) throw new Error(`missing zh-CN key: ${key}`);
  return raw;
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ description, title }: { description?: ReactNode; title?: ReactNode }) => (
    <div role="alert">
      <span>{title}</span>
      {description}
    </div>
  ),
}));

afterEach(() => cleanup());

const linkHref = (name: string) =>
  screen.getByRole('link', { name: dict[name] }).getAttribute('href');

describe('ErrorNotice', () => {
  it('sends a switched-off capability or a missing 服务号 to the admin IM connector tab', () => {
    for (const code of ['DINGTALK_FEATURE_DISABLED', 'DINGTALK_NOT_CONFIGURED']) {
      const view = render(<ErrorNotice error={new Error(code)} />);
      expect(
        screen.getByText(dict[`builtins.lobe-dingtalk-workspace.ui.error.${code}`]),
      ).toBeTruthy();
      expect(linkHref('builtins.dingtalk.action.adminImConnectors')).toBe(
        '/admin/system/general?tab=im-connectors',
      );
      view.unmount();
    }
  });

  it('links an unbound identity to the DingTalk binding page', () => {
    render(<ErrorNotice error={{ body: { code: 'DINGTALK_IDENTITY_UNBOUND' } }} />);

    expect(linkHref('builtins.dingtalk.action.binding')).toBe('/settings/messenger/dingtalk');
  });

  it('offers no link where no page can help', () => {
    render(<ErrorNotice error={new Error('DINGTALK_IDENTITY_INACTIVE')} />);

    expect(
      screen.getByText(
        dict['builtins.lobe-dingtalk-workspace.ui.error.DINGTALK_IDENTITY_INACTIVE'],
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
