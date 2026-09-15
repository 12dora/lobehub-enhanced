/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AdminAuditConversationMessageAttachment } from '@/enterprise/client/services/adminAudit';

import MessageBubble from './MessageBubble';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: {},
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  m: { div: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
  useReducedMotion: () => true,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({
    'aria-label': ariaLabel,
    children,
    role,
  }: {
    'aria-label'?: string;
    'children'?: ReactNode;
    'role'?: string;
  }) => (
    <div aria-label={ariaLabel} role={role}>
      {children}
    </div>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('../shared/format', () => ({
  formatAdminDateTime: () => '2026-01-02 00:00',
}));

const attachment: AdminAuditConversationMessageAttachment = {
  fileId: 'f1',
  fileType: 'application/pdf',
  name: 'notes.pdf',
  size: 2048,
  url: '/f/f1',
};

const message = (patch: Record<string, unknown> = {}) =>
  ({
    content: 'See https://example.com/a [REDACTED secret]',
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    hasContent: true,
    id: 'm1',
    role: 'user',
    ...patch,
  }) as Parameters<typeof MessageBubble>[0]['message'];

describe('MessageBubble', () => {
  it('linkifies absolute http(s) URLs and keeps [REDACTED] chips as plain text', () => {
    render(<MessageBubble message={message()} />);

    const link = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(link.getAttribute('href')).toBe('https://example.com/a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('[REDACTED secret]')).toBeTruthy();
  });

  it('renders attachments under the body when the array is non-empty', () => {
    render(<MessageBubble message={message({ attachments: [attachment] })} />);

    const fileLink = screen.getByRole('link', {
      name: 'audit.conversations.message.openAttachment: notes.pdf',
    });
    expect(fileLink.getAttribute('href')).toBe('/f/f1');
    expect(fileLink.getAttribute('target')).toBe('_blank');
    expect(fileLink.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not render attachments when the policy hides bodies', () => {
    render(
      <MessageBubble bodyHidden message={message({ attachments: [attachment], content: null })} />,
    );

    expect(screen.getByText('audit.live.message.bodyHidden')).toBeTruthy();
    expect(screen.queryByText('notes.pdf')).toBeNull();
    expect(screen.queryByLabelText('audit.conversations.message.attachments')).toBeNull();
  });
});
