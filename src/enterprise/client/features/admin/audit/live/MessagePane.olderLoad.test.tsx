/**
 * Live keeps click-to-load for older history: unlike the history transcript it passes no
 * `onNearTop`, so reaching the top of the stream never fetches on its own.
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
  m: { div: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
  useReducedMotion: () => true,
}));

vi.mock('./MessagePaneHeader', () => ({ default: () => null }));

vi.mock('../shared/AuditChatMessage', () => ({
  default: ({ message }: { message: AdminAuditConversationMessage }) => <div>{message.id}</div>,
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

const messages = Array.from(
  { length: 30 },
  (_, i) =>
    ({
      content: `m${i}`,
      createdAt: new Date(Date.UTC(2024, 0, 1, 0, i)),
      hasContent: true,
      id: `m${i}`,
      role: 'user',
    }) as AdminAuditConversationMessage,
);

describe('MessagePane older history (live)', () => {
  it('does not auto-load older pages when scrolled to the top; the button still loads', () => {
    const onLoadOlder = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <MessagePane
          hasOlder
          bodyHidden={false}
          messages={messages}
          topic={topic}
          userId="u1"
          onLoadOlder={onLoadOlder}
        />
      </MemoryRouter>,
    );
    const stream = container.querySelector('.stream') as HTMLDivElement;
    Object.defineProperty(stream, 'clientHeight', { configurable: true, get: () => 200 });
    Object.defineProperty(stream, 'scrollHeight', { configurable: true, get: () => 1200 });

    for (const top of [120, 40, 0]) {
      stream.scrollTop = top;
      fireEvent.scroll(stream);
    }
    expect(onLoadOlder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });
});
