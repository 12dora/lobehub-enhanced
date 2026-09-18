/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AdminAuditUserSummary } from '@/enterprise/client/services/adminAudit';

import UserSummaryCard from './UserSummaryCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_, key) => String(key) }),
  cssVar: {},
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ title }: { title?: ReactNode }) => <div role="alert">{title}</div>,
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  Text: ({
    children,
    ellipsis,
  }: {
    children?: ReactNode;
    ellipsis?: boolean | { tooltip?: string; tooltipWhenOverflow?: boolean };
  }) => (
    <span
      data-ellipsis={ellipsis ? '1' : undefined}
      data-tooltip={typeof ellipsis === 'object' ? ellipsis.tooltip : undefined}
    >
      {children}
    </span>
  ),
}));

vi.mock('../shared/format', () => ({
  formatAdminDateTime: () => '2026-01-02 00:00',
}));

const email = 'very.long.address.for.audit@enterprise-example.com';

describe('UserSummaryCard', () => {
  it('keeps the email on one line with an overflow tooltip carrying the full address', () => {
    render(
      <UserSummaryCard
        failed={false}
        user={{ email, username: 'u' } as AdminAuditUserSummary}
        onRetry={() => {}}
      />,
    );

    const value = screen.getByText(email);
    expect(value.getAttribute('data-ellipsis')).toBe('1');
    expect(value.getAttribute('data-tooltip')).toBe(email);
    // The email cell gets its own wider flex basis instead of an equal 140px grid track.
    expect(value.parentElement?.className).toBe('emailCell');
  });

  it('shows an em dash when the summary has no email', () => {
    render(<UserSummaryCard failed={false} user={undefined} onRetry={() => {}} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
