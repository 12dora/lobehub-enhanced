/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import chatCopy from '@/locales/default/chat';

import Controls from './Controls';

const CURRENT_SCOPE = 'user-1:personal';

const mocks = vi.hoisted(() => ({
  cacheScope: 'user-1:personal',
  /** Availability per cache scope, mirroring the store's scope-keyed map. */
  embeddingAvailableByScope: {} as Record<string, boolean | undefined>,
  memoryEnabled: true,
  updateAgentChatConfig: vi.fn(),
}));

vi.mock('react-i18next', async () => {
  const chat = (await import('@/locales/default/chat')).default as Record<string, string>;

  return {
    useTranslation: () => ({ t: (key: string) => chat[key] ?? key }),
  };
});

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => 'agent-1' }));

vi.mock('../../hooks/useUpdateAgentConfig', () => ({
  useUpdateAgentConfig: () => ({ updateAgentChatConfig: mocks.updateAgentChatConfig }),
}));

vi.mock('./useMemoryEnabled', () => ({ useMemoryEnabled: () => mocks.memoryEnabled }));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: undefined }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  chatConfigByIdSelectors: {
    getMemoryToolEffortById: () => () => 'medium',
  },
}));

vi.mock('@/libs/swr/useCacheScope', () => ({ useCacheScope: () => mocks.cacheScope }));

vi.mock('@/store/userMemory', () => ({
  useUserMemoryStore: (selector: (state: unknown) => unknown) => selector({}),
  userMemorySelectors: {
    memoryEmbeddingAvailable: (scope: string) => () => mocks.embeddingAvailableByScope[scope],
  },
}));

vi.mock('@/features/ModelSwitchPanel/components/ControlsForm/LevelSlider', () => ({
  default: () => <div data-testid="memory-effort-slider" />,
}));

const HINT = chatCopy['memory.embeddingUnavailable'];

describe('Memory Controls', () => {
  beforeEach(() => {
    mocks.cacheScope = CURRENT_SCOPE;
    mocks.embeddingAvailableByScope = {};
    mocks.memoryEnabled = true;
    mocks.updateAgentChatConfig.mockClear();
  });

  it('shows the admin hint when no embedding model is configured', () => {
    mocks.embeddingAvailableByScope = { [CURRENT_SCOPE]: false };

    render(<Controls />);

    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it('keeps the toggle usable while the hint is shown', () => {
    mocks.embeddingAvailableByScope = { [CURRENT_SCOPE]: false };
    mocks.memoryEnabled = false;

    render(<Controls />);
    fireEvent.click(screen.getByText(chatCopy['memory.on.title']));

    expect(mocks.updateAgentChatConfig).toHaveBeenCalledWith({ memory: { enabled: true } });
  });

  it('shows no hint while availability is unknown', () => {
    mocks.embeddingAvailableByScope = { [CURRENT_SCOPE]: undefined };

    render(<Controls />);

    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('ignores an "unavailable" result from another account / workspace scope', () => {
    mocks.embeddingAvailableByScope = { 'user-1:workspace-a': false };
    mocks.cacheScope = 'user-1:workspace-b';

    render(<Controls />);

    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('shows no hint when an embedding model is configured', () => {
    mocks.embeddingAvailableByScope = { [CURRENT_SCOPE]: true };

    render(<Controls />);

    expect(screen.queryByText(HINT)).toBeNull();
  });
});
