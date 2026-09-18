/**
 * The "new messages" jump control must overlay the fixed-height pane, not sit at the end of the
 * scrolled transcript (where it is below the fold exactly when the auditor has scrolled up).
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type {
  AdminAuditConversationDetail,
  AdminAuditConversationMessage,
} from '@/enterprise/client/services/adminAudit';

import MessagePane from './MessagePane';

const scrollToBottom = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_, key) => String(key) }),
  cssVar: {},
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  SkeletonText: () => null,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  m: {
    div: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
  },
  useReducedMotion: () => true,
}));

vi.mock('../shared/AuditChatMessageList', () => ({
  default: () => <div data-testid="transcript" />,
}));

vi.mock('../shared/useAuditStreamScroll', () => ({
  useAuditStreamScroll: () => ({
    onScroll: () => {},
    scrollRef: { current: null },
    scrollToBottom,
    showJump: true,
  }),
}));

const topic = {
  agentId: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  id: 'topic-1',
  model: 'gpt',
  provider: 'openai',
  title: 't',
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  userId: 'u1',
} as AdminAuditConversationDetail;

describe('MessagePane jump overlay', () => {
  it('renders the jump control as a sibling of the scroller inside the positioned viewport', () => {
    render(
      <MemoryRouter>
        <MessagePane
          bodyHidden={false}
          hasOlder={false}
          messages={[{ id: 'm1' } as AdminAuditConversationMessage]}
          topic={topic}
          userId="u1"
          onLoadOlder={() => {}}
        />
      </MemoryRouter>,
    );

    const button = screen.getByText('audit.live.messages.jumpNew');
    const jump = button.closest('.jump') as HTMLElement;
    const stream = screen.getByTestId('transcript').closest('.stream') as HTMLElement;

    expect(stream.contains(jump)).toBe(false);
    expect(jump.parentElement?.className).toBe('streamViewport');
    expect(stream.parentElement).toBe(jump.parentElement);

    fireEvent.click(button);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });
});
