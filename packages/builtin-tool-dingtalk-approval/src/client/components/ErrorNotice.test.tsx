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
  it('sends switched-off approval or automation to the admin IM connector tab', () => {
    for (const code of ['DINGTALK_FEATURE_DISABLED', 'DINGTALK_AUTOMATION_OFF']) {
      const view = render(<ErrorNotice error={new Error(code)} />);
      expect(linkHref('builtins.dingtalk.action.adminImConnectors')).toBe(
        '/admin/system/general?tab=im-connectors',
      );
      view.unmount();
    }
  });

  it('links an unverified identity to the DingTalk binding page', () => {
    render(<ErrorNotice error={new Error('DINGTALK_IDENTITY_UNVERIFIED')} />);

    expect(
      screen.getByText(
        dict['builtins.lobe-dingtalk-approval.ui.error.DINGTALK_IDENTITY_UNVERIFIED'],
      ),
    ).toBeTruthy();
    expect(linkHref('builtins.dingtalk.action.binding')).toBe('/settings/messenger/dingtalk');
  });

  it('sends a member at the rule limit to their approval rules', () => {
    render(<ErrorNotice error={new Error('DINGTALK_RULE_LIMIT')} />);

    expect(linkHref('builtins.dingtalk.action.approvalRules')).toBe('/settings/approval-rules');
  });

  it('offers no link where no page can help', () => {
    render(<ErrorNotice error={new Error('DINGTALK_IDENTITY_INACTIVE')} />);

    expect(
      screen.getByText(dict['builtins.lobe-dingtalk-approval.ui.error.DINGTALK_IDENTITY_INACTIVE']),
    ).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
