/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  Button: ({
    children,
    loading,
    onClick,
  }: {
    children?: ReactNode;
    loading?: boolean;
    onClick?: () => void;
  }) => (
    <button data-loading={loading ? '1' : '0'} type="button" onClick={onClick}>
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
  hasOlder: false,
  isLoading: false,
  items: ids.map((id) => ({ id }) as FeedItem),
  loadOlder: vi.fn(),
  loadingOlder: false,
  olderError: false,
  resetKey: 'u:t:meta:0',
  retry: vi.fn(),
  ...patch,
});

/** happy-dom has no layout: drive the box's scroll metrics by hand (40px per message). */
const withLayout = (box: HTMLDivElement, clientHeight = 200) => {
  const count = () =>
    box.querySelector('[data-testid="chat-list"]')?.textContent?.split(',').length ?? 0;
  Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => count() * 40 });
};

const scrollBox = (container: HTMLElement) => container.firstElementChild as HTMLDivElement;

describe('TopicMessageStream', () => {
  it('renders the transcript through the shared chat list inside the scroll box', () => {
    const { container } = render(
      <TopicMessageStream assistantName="Helper" feed={feed(['m1', 'm2'])} />,
    );

    const list = screen.getByTestId('chat-list');
    expect(list.textContent).toBe('m1,m2');
    expect(list.getAttribute('data-assistant')).toBe('Helper');
    expect(scrollBox(container).className).toBe('streamBox');
  });

  it('has no pager below the box', () => {
    render(<TopicMessageStream feed={feed(['m1'], { hasOlder: true })} />);

    expect(screen.queryByText('primitives.dataTable.next')).toBeNull();
    expect(screen.queryByText('primitives.dataTable.previous')).toBeNull();
  });

  it('shows a skeleton while the first page loads', () => {
    render(<TopicMessageStream feed={feed([], { isLoading: true })} />);

    expect(screen.getByTestId('skeleton')).toBeTruthy();
    expect(screen.queryByTestId('chat-list')).toBeNull();
    expect(screen.queryByText('audit.conversations.topic.emptyMessages')).toBeNull();
    expect(screen.queryByText('audit.live.messages.loadOlder')).toBeNull();
  });

  it('offers retry when the first page fails', () => {
    const retry = vi.fn();
    render(<TopicMessageStream feed={feed([], { hasError: true, retry })} />);

    expect(screen.getByRole('alert').textContent).toBe('audit.conversations.topic.loadError');
    fireEvent.click(screen.getByText('primitives.dataTable.retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when the topic has no messages', () => {
    render(<TopicMessageStream feed={feed([])} />);

    expect(screen.getByText('audit.conversations.topic.emptyMessages')).toBeTruthy();
    expect(screen.queryByText('audit.conversations.topic.startOfConversation')).toBeNull();
  });

  it('marks the start of the conversation once no older page remains', () => {
    render(<TopicMessageStream feed={feed(['m1'])} />);

    expect(screen.getByText('audit.conversations.topic.startOfConversation')).toBeTruthy();
    expect(screen.queryByText('audit.live.messages.loadOlder')).toBeNull();
  });

  it('shows the older-page control at the top with its loading state and failure', () => {
    const loadOlder = vi.fn();
    const { rerender } = render(
      <TopicMessageStream feed={feed(['m1'], { hasOlder: true, loadOlder })} />,
    );

    const button = screen.getByText('audit.live.messages.loadOlder');
    expect(
      button.compareDocumentPosition(screen.getByTestId('chat-list')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(button);
    expect(loadOlder).toHaveBeenCalledTimes(1);

    rerender(
      <TopicMessageStream feed={feed(['m1'], { hasOlder: true, loadOlder, loadingOlder: true })} />,
    );
    expect(screen.getByText('audit.live.messages.loadOlder').getAttribute('data-loading')).toBe(
      '1',
    );

    rerender(
      <TopicMessageStream feed={feed(['m1'], { hasOlder: true, loadOlder, olderError: true })} />,
    );
    expect(screen.getByRole('alert').textContent).toBe('audit.live.errors.loadMoreMessages');
  });

  it('opens at the newest message (bottom) on first load', () => {
    const { container, rerender } = render(
      <TopicMessageStream feed={feed([], { isLoading: true })} />,
    );
    const box = scrollBox(container);
    withLayout(box);

    rerender(<TopicMessageStream feed={feed(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'])} />);
    expect(box.scrollTop).toBe(box.scrollHeight);
  });

  it('loads older history when scrolled near the top, but not while at the bottom', () => {
    const loadOlder = vi.fn();
    const ids = Array.from({ length: 20 }, (_, i) => `m${i}`);
    const { container } = render(
      <TopicMessageStream feed={feed(ids, { hasOlder: true, loadOlder })} />,
    );
    const box = scrollBox(container);
    withLayout(box);

    box.scrollTop = box.scrollHeight - box.clientHeight;
    fireEvent.scroll(box);
    expect(loadOlder).not.toHaveBeenCalled();

    box.scrollTop = 20;
    fireEvent.scroll(box);
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('does not ask for more near the top once the start is reached or a load is running', () => {
    const loadOlder = vi.fn();
    const ids = Array.from({ length: 20 }, (_, i) => `m${i}`);
    const { container, rerender } = render(<TopicMessageStream feed={feed(ids, { loadOlder })} />);
    const box = scrollBox(container);
    withLayout(box);

    box.scrollTop = 0;
    fireEvent.scroll(box);
    rerender(
      <TopicMessageStream feed={feed(ids, { hasOlder: true, loadOlder, loadingOlder: true })} />,
    );
    fireEvent.scroll(box);
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it('keeps the reading position anchored when an older page prepends', () => {
    const newest = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const older = Array.from({ length: 10 }, (_, i) => `o${i}`);
    const { container, rerender } = render(
      <TopicMessageStream feed={feed(newest, { hasOlder: true })} />,
    );
    const box = scrollBox(container);
    withLayout(box);

    box.scrollTop = 30;
    fireEvent.scroll(box);
    rerender(<TopicMessageStream feed={feed(newest, { hasOlder: true, loadingOlder: true })} />);
    const heightBefore = box.scrollHeight;

    act(() => {
      rerender(<TopicMessageStream feed={feed([...older, ...newest])} />);
    });

    const grownBy = box.scrollHeight - heightBefore;
    expect(grownBy).toBeGreaterThan(0);
    expect(box.scrollTop).toBe(30 + grownBy);
    expect(screen.getByTestId('chat-list').textContent?.startsWith('o0,')).toBe(true);
  });

  it('jumps back to the newest message when the transcript restarts (e.g. body toggle)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `m${i}`);
    const { container, rerender } = render(<TopicMessageStream feed={feed(ids)} />);
    const box = scrollBox(container);
    withLayout(box);

    box.scrollTop = 0;
    fireEvent.scroll(box);
    rerender(<TopicMessageStream feed={feed(ids, { resetKey: 'u:t:body:1' })} />);
    expect(box.scrollTop).toBe(box.scrollHeight);
  });
});
