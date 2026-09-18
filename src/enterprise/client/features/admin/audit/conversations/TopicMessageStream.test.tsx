/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AdminAuditConversationMessage } from '@/enterprise/client/services/adminAudit';

import TopicMessageStream from './TopicMessageStream';
import type { TopicEvidence } from './useTopicEvidence';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_, key) => String(key) }),
  cssVar: {},
}));

vi.mock('motion/react', () => ({
  useReducedMotion: () => true,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  SkeletonText: () => <div data-testid="skeleton" />,
  Text: ({ children, role }: { children?: ReactNode; role?: string }) => (
    <span role={role}>{children}</span>
  ),
}));

// Turn rendering (markdown, chips, attachments, placeholders) is covered by
// shared/AuditChatMessageList.test.tsx — here we only check the stream wiring.
vi.mock('../shared/AuditChatMessageList', () => ({
  default: ({
    assistantName,
    messages,
  }: {
    assistantName?: string;
    messages: AdminAuditConversationMessage[];
  }) => (
    <div data-assistant={assistantName} data-testid="chat-list">
      {messages.map((m) => m.id).join(',')}
    </div>
  ),
}));

type FeedItem = TopicEvidence['messages']['items'][number];

const feed = (
  ids: string[],
  patch: Partial<TopicEvidence['messages']> = {},
): TopicEvidence['messages'] => ({
  hasData: ids.length > 0,
  hasError: false,
  isLoading: false,
  items: ids.map((id) => ({ id }) as FeedItem),
  retry: vi.fn(),
  ...patch,
});

describe('TopicMessageStream', () => {
  it('renders the page through the shared chat list inside the scroll box', () => {
    const { container } = render(
      <TopicMessageStream assistantName="Helper" feed={feed(['m1', 'm2'])} />,
    );

    const list = screen.getByTestId('chat-list');
    expect(list.textContent).toBe('m1,m2');
    expect(list.getAttribute('data-assistant')).toBe('Helper');
    expect(container.firstElementChild?.className).toBe('streamBox');
  });

  it('shows a skeleton while the first page loads', () => {
    render(<TopicMessageStream feed={feed([], { isLoading: true })} />);

    expect(screen.getByTestId('skeleton')).toBeTruthy();
    expect(screen.queryByTestId('chat-list')).toBeNull();
    expect(screen.queryByText('audit.conversations.topic.emptyMessages')).toBeNull();
  });

  it('offers retry when the first page fails', () => {
    const retry = vi.fn();
    render(<TopicMessageStream feed={feed([], { hasError: true, retry })} />);

    expect(screen.getByRole('alert').textContent).toBe('audit.conversations.topic.loadError');
    fireEvent.click(screen.getByText('primitives.dataTable.retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when the page has no messages', () => {
    render(<TopicMessageStream feed={feed([])} />);

    expect(screen.getByText('audit.conversations.topic.emptyMessages')).toBeTruthy();
  });

  it('scrolls back to the top when a new page replaces the items', () => {
    const { container, rerender } = render(<TopicMessageStream feed={feed(['m1'])} />);
    const box = container.firstElementChild as HTMLDivElement;
    box.scrollTop = 200;

    rerender(<TopicMessageStream feed={feed(['m9'])} />);
    expect(box.scrollTop).toBe(0);
  });
});
