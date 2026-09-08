/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InputArea from './index';

const prefetchAgentSurfaceMock = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({
  isAgentConfigLoading: false,
  lastSendButtonProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock('@/features/HomeConversation', () => ({
  prefetchAgentSurface: prefetchAgentSurfaceMock,
}));

vi.mock('./useSend', () => ({
  useSend: () => ({ agentId: 'agt_inbox', loading: false, send: vi.fn() }),
}));

vi.mock('./InputDragUpload', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/DragUploadZone', () => ({
  useUploadFiles: () => ({ handleUploadFiles: vi.fn() }),
}));

vi.mock('@/features/ChatInput', () => ({
  ChatInputProvider: ({
    children,
    sendButtonProps,
  }: {
    children: React.ReactNode;
    sendButtonProps?: Record<string, unknown>;
  }) => {
    mocks.lastSendButtonProps = sendButtonProps;
    return <>{children}</>;
  },
  DesktopChatInput: ({ isConfigLoading }: { isConfigLoading?: boolean }) => (
    <textarea data-config-loading={String(isConfigLoading)} data-testid="composer" />
  ),
}));

vi.mock('@/hooks/useInitAgentConfig', () => ({ useInitAgentConfig: () => ({ isLoading: false }) }));
vi.mock('@/hooks/useHomeDailyBrief', () => ({
  useHomeDailyBrief: () => ({ advance: vi.fn(), currentPair: undefined }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentModelById: () => () => 'gpt-4o',
    getAgentModelProviderById: () => () => 'openai',
    isAgentConfigLoadingById: () => () => mocks.isAgentConfigLoading,
  },
}));
vi.mock('@/store/chat', () => ({
  useChatStore: Object.assign((selector: (s: unknown) => unknown) => selector({}), {
    setState: vi.fn(),
  }),
}));

describe('Home InputArea', () => {
  beforeEach(() => {
    prefetchAgentSurfaceMock.mockReset();
    mocks.isAgentConfigLoading = false;
    mocks.lastSendButtonProps = undefined;
  });

  it('warms the lazy conversation chunk as soon as the composer takes focus', () => {
    render(<InputArea />);

    expect(prefetchAgentSurfaceMock).not.toHaveBeenCalled();

    // Focus bubbles up through the capture handler on the composer wrapper —
    // the chunk has to be resolved before Enter swaps the right column, or
    // `DelayedFallback` leaves it blank for its first 200ms.
    fireEvent.focus(screen.getByTestId('composer'));

    expect(prefetchAgentSurfaceMock).toHaveBeenCalled();
  });

  /**
   * The composer footer waits for the model catalogue too, but that wait lives inside
   * `DesktopChatInput` (`useComposerFooterLoading`). The send button must never inherit
   * it — only the agent config decides whether sending is possible.
   */
  describe('send button gating', () => {
    it('disables the send button on the agent config alone', () => {
      mocks.isAgentConfigLoading = true;
      const { unmount } = render(<InputArea />);
      expect(mocks.lastSendButtonProps?.disabled).toBe(true);
      // The catalogue wait is the composer's business, not the caller's.
      expect(screen.getByTestId('composer')).toHaveAttribute('data-config-loading', 'true');

      unmount();
      mocks.isAgentConfigLoading = false;
      render(<InputArea />);

      expect(mocks.lastSendButtonProps?.disabled).toBe(false);
      expect(screen.getByTestId('composer')).toHaveAttribute('data-config-loading', 'false');
    });
  });
});
