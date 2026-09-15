/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TopicMessageStream from './TopicMessageStream';
import type { TopicEvidence } from './useTopicEvidence';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: {},
}));

vi.mock('motion/react', () => ({
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
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  SkeletonText: () => <div data-testid="skeleton" />,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('../shared/format', () => ({
  formatAdminDateTime: () => '2026-01-02 00:00',
}));

type FeedItem = TopicEvidence['messages']['items'][number];

/** Tests only set the fields the component reads; the rest of the DTO is irrelevant here. */
const feed = (
  partialItems: Array<Partial<FeedItem> & Pick<FeedItem, 'id'>>,
  patch: Partial<TopicEvidence['messages']> = {},
): TopicEvidence['messages'] => ({
  hasData: partialItems.length > 0,
  hasError: false,
  isLoading: false,
  items: partialItems as FeedItem[],
  retry: vi.fn(),
  ...patch,
});

describe('TopicMessageStream', () => {
  it('linkifies absolute http(s) URLs and keeps [REDACTED] chips as plain text', () => {
    render(
      <TopicMessageStream
        feed={feed([
          {
            content: 'See https://example.com/a [REDACTED secret] then /f/not-a-link',
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            hasContent: true,
            id: 'm1',
            role: 'user',
          },
        ])}
      />,
    );

    const link = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(link.getAttribute('href')).toBe('https://example.com/a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('[REDACTED secret]')).toBeTruthy();
    expect(screen.getByText(/\/f\/not-a-link/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: '/f/not-a-link' })).toBeNull();
  });

  it('renders attachments under the body when the array is non-empty', () => {
    render(
      <TopicMessageStream
        feed={feed([
          {
            attachments: [
              {
                fileId: 'f1',
                fileType: 'application/pdf',
                name: 'notes.pdf',
                size: 2048,
                url: '/f/f1',
              },
            ],
            content: 'with file',
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            hasContent: true,
            id: 'm1',
            role: 'user',
          } as TopicEvidence['messages']['items'][number],
        ])}
      />,
    );

    expect(screen.getByText('with file')).toBeTruthy();
    const fileLink = screen.getByRole('link', {
      name: 'audit.conversations.message.openAttachment: notes.pdf',
    });
    expect(fileLink.getAttribute('href')).toBe('/f/f1');
    expect(fileLink.getAttribute('title')).toBe('notes.pdf');
  });

  it('does not render attachments when the body exists but is not loaded', () => {
    render(
      <TopicMessageStream
        feed={feed([
          {
            attachments: [
              {
                fileId: 'f1',
                fileType: 'application/pdf',
                name: 'notes.pdf',
                size: 2048,
                url: '/f/f1',
              },
            ],
            content: null,
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            hasContent: true,
            id: 'm1',
            role: 'user',
          } as TopicEvidence['messages']['items'][number],
        ])}
      />,
    );

    expect(screen.getByText('audit.conversations.topic.bodyNotLoaded')).toBeTruthy();
    expect(screen.queryByLabelText('audit.conversations.message.attachments')).toBeNull();
    expect(screen.queryByText('notes.pdf')).toBeNull();
  });

  it('still renders attachments on file-only messages with no body text', () => {
    render(
      <TopicMessageStream
        feed={feed([
          {
            attachments: [
              {
                fileId: 'f1',
                fileType: 'application/pdf',
                name: 'notes.pdf',
                size: 2048,
                url: '/f/f1',
              },
            ],
            content: '',
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            hasContent: false,
            id: 'm1',
            role: 'user',
          } as TopicEvidence['messages']['items'][number],
        ])}
      />,
    );

    expect(screen.getByText('—')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'audit.conversations.message.openAttachment: notes.pdf' }),
    ).toBeTruthy();
  });

  it('does not render an attachment list when the field is omitted', () => {
    render(
      <TopicMessageStream
        feed={feed([
          {
            content: 'no files',
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            hasContent: true,
            id: 'm1',
            role: 'user',
          },
        ])}
      />,
    );

    expect(screen.getByText('no files')).toBeTruthy();
    expect(screen.queryByLabelText('audit.conversations.message.attachments')).toBeNull();
  });
});
