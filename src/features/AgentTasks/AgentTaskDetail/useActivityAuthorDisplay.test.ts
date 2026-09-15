/**
 * @vitest-environment happy-dom
 */
import type { TaskDetailActivityAuthor } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActivityAuthorDisplay } from './useActivityAuthorDisplay';

const mocks = vi.hoisted(() => ({
  agentState: {} as any,
  homeState: {} as any,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/enterprise/client/providers/RuntimeBrandingProvider', () => ({
  useBranding: () => ({}),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) => selector(mocks.agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentMetaById: (id: string) => (s: any) => s.agentMap?.[id],
  },
  builtinAgentSelectors: {
    inboxAgentId: (s: any) => s.inboxAgentId,
  },
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: any) => selector(mocks.homeState),
}));

vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    getAgentById: (id: string) => (s: any) => s.agentMap?.[id],
  },
}));

const INBOX_AGENT_ID = 'agt_inbox';

describe('useActivityAuthorDisplay', () => {
  beforeEach(() => {
    // The seeded client-side inbox identity that used to override the server author.
    mocks.agentState = {
      agentMap: { [INBOX_AGENT_ID]: { avatar: '/custom-inbox.png', title: 'Lobe AI' } },
      inboxAgentId: INBOX_AGENT_ID,
    };
    mocks.homeState = { agentMap: {} };
  });

  it('keeps the server-resolved inbox author identity instead of the stored inbox title', () => {
    const author: TaskDetailActivityAuthor = {
      avatar: 'a.png',
      id: INBOX_AGENT_ID,
      isInbox: true,
      name: 'Published assistant',
      type: 'agent',
    };

    const { result } = renderHook(() => useActivityAuthorDisplay(author));

    expect(result.current).toMatchObject({
      avatar: 'a.png',
      id: INBOX_AGENT_ID,
      name: 'Published assistant',
    });
  });

  it('falls back to the client inbox meta when the server author carries no identity', () => {
    const author: TaskDetailActivityAuthor = {
      avatar: '   ',
      id: INBOX_AGENT_ID,
      isInbox: true,
      name: '   ',
      type: 'agent',
    };

    const { result } = renderHook(() => useActivityAuthorDisplay(author));

    expect(result.current?.name).toBe('Lobe AI');
    expect(result.current?.avatar).toBe('/custom-inbox.png');
  });

  it('returns a non-inbox agent author unchanged', () => {
    const author: TaskDetailActivityAuthor = {
      avatar: 'b.png',
      id: 'agt_other',
      name: 'Research agent',
      type: 'agent',
    };

    const { result } = renderHook(() => useActivityAuthorDisplay(author));

    expect(result.current).toBe(author);
  });

  it('returns undefined when there is no author', () => {
    const { result } = renderHook(() => useActivityAuthorDisplay(undefined));

    expect(result.current).toBeUndefined();
  });
});
