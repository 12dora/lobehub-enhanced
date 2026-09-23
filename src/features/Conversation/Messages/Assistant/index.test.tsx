/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AssistantMessage from './index';

const state = vi.hoisted(() => ({
  editing: false,
  generating: false,
  interrupted: false,
  isCreating: false,
  message: {} as Record<string, unknown>,
}));

vi.mock('../../store', () => ({
  dataSelectors: { getDisplayMessageById: () => () => state.message },
  messageStateSelectors: {
    isMessageCreating: () => () => state.isCreating,
    isMessageEditing: () => () => state.editing,
    isMessageGenerating: () => () => state.generating,
    isMessageInterrupted: () => () => state.interrupted,
  },
  useConversationStore: (selector: (s: unknown) => unknown) => selector({}),
}));

// Mirror the real ChatItem slots: the body (`children`) AND `messageExtra`,
// which is where the component places <InterruptedHint />.
vi.mock('@/features/Conversation/ChatItem', () => ({
  ChatItem: ({ children, messageExtra }: { children: ReactNode; messageExtra?: ReactNode }) => (
    <div data-testid="chat-item">
      {children}
      {messageExtra}
    </div>
  ),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: { config: () => ({ isDevMode: false }) },
}));

vi.mock('../../Error', () => ({
  default: () => null,
  useErrorContent: (error: unknown) => (error ? { message: 'error' } : undefined),
}));

vi.mock('../../hooks', () => ({
  useAgentMeta: () => ({}),
  useDoubleClickEdit: () => undefined,
}));

vi.mock('../../utils/markdown', () => ({
  normalizeThinkTags: (s: string) => s,
  processWithArtifact: (s: string) => s,
}));

vi.mock('../components/MessageBranch', () => ({ default: () => null }));
vi.mock('../Contexts/message-action-context', () => ({
  useSetMessageItemActionElementPortialContext: () => vi.fn(),
  useSetMessageItemActionTypeContext: () => vi.fn(),
}));
vi.mock('./components/InterruptedHint', () => ({
  default: () => <div data-testid="interrupted-hint" />,
}));
// Body stub: only records what it was given. Whether an idle "..." renders an
// ellipsis is DisplayContent's job and is covered in DisplayContent.test.tsx.
vi.mock('./components/MessageContent', () => ({
  default: ({ content }: { content: string }) => <div data-testid="content">{content}</div>,
}));
vi.mock('./components/TruncationNotice', () => ({ default: () => null }));
vi.mock('./Extra', () => ({ AssistantMessageExtra: () => null }));
vi.mock('./Extra/ModerationNotice', () => ({ default: () => null }));

const placeholder = { content: '...', createdAt: 1, id: 'a1', role: 'assistant' };

describe('AssistantMessage — ended empty placeholder', () => {
  beforeEach(() => {
    state.editing = false;
    state.generating = false;
    state.interrupted = false;
    state.isCreating = false;
    state.message = { ...placeholder };
  });

  afterEach(() => {
    cleanup();
  });

  it.each(['...', '', '  '])(
    'renders no bubble for a finished run that left content %j',
    (content) => {
      state.message = { ...placeholder, content };
      render(<AssistantMessage id="a1" index={0} />);

      expect(screen.queryByTestId('chat-item')).toBeNull();
    },
  );

  it('keeps the bubble (with its loader) while the run is still generating', () => {
    state.generating = true;
    render(<AssistantMessage id="a1" index={0} />);

    expect(screen.getByTestId('chat-item')).toBeTruthy();
  });

  it('keeps the bubble while the message is being created', () => {
    state.isCreating = true;
    render(<AssistantMessage id="a1" index={0} />);

    expect(screen.getByTestId('chat-item')).toBeTruthy();
  });

  it('shows a run stopped before its first token as interrupted (live cancelled op)', () => {
    state.interrupted = true;
    render(<AssistantMessage id="a1" index={0} />);

    expect(screen.getByTestId('chat-item')).toBeTruthy();
    expect(screen.getByTestId('interrupted-hint')).toBeTruthy();
  });

  it('still shows it as interrupted after reload via the persisted abort finishType', () => {
    state.message = { ...placeholder, content: '', metadata: { finishType: 'abort' } };
    render(<AssistantMessage id="a1" index={0} />);

    expect(screen.getByTestId('chat-item')).toBeTruthy();
    expect(screen.getByTestId('interrupted-hint')).toBeTruthy();
  });

  it('does not add the interrupted hint to an ordinary reply', () => {
    state.message = { ...placeholder, content: 'done', metadata: { finishType: 'done' } };
    render(<AssistantMessage id="a1" index={0} />);

    expect(screen.queryByTestId('interrupted-hint')).toBeNull();
  });

  it('keeps an errored placeholder so the error is shown', () => {
    state.message = { ...placeholder, error: { type: 'ProviderBizError' } };
    render(<AssistantMessage id="a1" index={0} />);

    expect(screen.getByTestId('chat-item')).toBeTruthy();
  });

  it('keeps a placeholder that carries reasoning', () => {
    state.message = { ...placeholder, reasoning: { content: 'thinking' } };
    render(<AssistantMessage id="a1" index={0} />);

    expect(screen.getByTestId('chat-item')).toBeTruthy();
  });

  it('renders a real reply normally', () => {
    state.message = { ...placeholder, content: '模板「工具借用审批」还在，未删除。' };
    render(<AssistantMessage id="a1" index={0} />);

    expect(screen.getByTestId('content').textContent).toBe('模板「工具借用审批」还在，未删除。');
  });
});
