/**
 * Cached conversation evidence remains visible when detail revalidation fails.
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConversationTopicPage from './ConversationTopicPage';

const SECRET = 'sk-abcdefghijklmnopqrstuvwxyz012345';

const evidence = vi.hoisted(() => ({
  detailListeners: new Set<() => void>(),
  detailMutate: vi.fn(),
  permissions: ['platform_audit:conversation_read:all'] as string[],
  detailSnapshot: {
    data: {
      agentId: 'agent-1',
      contentAccessMode: 'metadata_only' as 'content_allowed' | 'metadata_only',
      model: 'cached-model',
      provider: 'cached-provider',
      redactionProfile: 'off' as string | undefined,
      title: 'Cached topic',
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    },
    error: new Error('detail refresh failed') as unknown,
    isLoading: false,
    isValidating: false,
  },
  messagesSnapshot: {
    data: {
      contentAccessMode: 'metadata_only' as 'content_allowed' | 'metadata_only',
      items: [
        {
          content: 'Cached message evidence',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          hasContent: true,
          id: 'message-1',
          role: 'user',
        },
      ],
      nextCursor: null as string | null,
      redactionProfile: 'off' as string | undefined,
    },
    error: undefined as unknown,
    isLoading: false,
    isValidating: false,
  },
  policySnapshot: {
    data: undefined as { redactionProfile?: string } | undefined,
  },
  confirm: vi.fn(),
  toastError: vi.fn(),
  messagesCursors: [] as Array<string | null | undefined>,
  messagesIncludeBody: [] as boolean[],
  messagesLimits: [] as Array<number | undefined>,
  messagesByTopic: {} as Record<string, unknown>,
  messagesCalls: [] as Array<{ includeBody: boolean; topicId?: string }>,
}));

const purgeMock = vi.hoisted(() => vi.fn(async () => undefined));
const listOlderMock = vi.hoisted(() => vi.fn());

vi.mock('@/enterprise/client/services/adminAudit', () => ({
  adminAuditService: {
    listConversationMessages: (...args: unknown[]) => listOlderMock(...args),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: () => '' }),
  cssVar: {},
  cx: (...names: unknown[]) => names.filter(Boolean).join(' '),
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  m: { div: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> },
  useReducedMotion: () => false,
}));

vi.mock('../shared/AuditMarkdown', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
  RedactionChip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/features/Conversation/ChatItem/components/Avatar', () => ({
  default: () => null,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Skeleton: () => <div data-testid="skeleton" />,
  Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Alert: ({ action, title }: { action?: React.ReactNode; title?: React.ReactNode }) => (
    <div role="alert">
      {title}
      {action}
    </div>
  ),
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  SkeletonText: () => <div data-testid="skeleton" />,
  Switch: ({
    'aria-label': ariaLabel,
    checked,
    onChange,
  }: {
    'aria-label'?: string;
    'checked'?: boolean;
    'onChange'?: (checked: boolean) => void;
  }) => (
    <input
      aria-label={ariaLabel}
      checked={checked}
      type="checkbox"
      onChange={(e) => onChange?.(e.target.checked)}
    />
  ),
  Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  toast: { error: (...args: unknown[]) => evidence.toastError(...args) },
}));

vi.mock('@/enterprise/client/providers/AdminAccessProvider', () => ({
  useAdminAccess: () => ({
    authMethod: 'better-auth',
    permissions: evidence.permissions,
    roles: [],
  }),
}));

vi.mock('../hooks/useAdminAudit', async () => {
  const React = await import('react');
  return {
    useFetchAuditConversation: () => {
      const snapshot = React.useSyncExternalStore(
        (listener) => {
          evidence.detailListeners.add(listener);
          return () => evidence.detailListeners.delete(listener);
        },
        () => evidence.detailSnapshot,
        () => evidence.detailSnapshot,
      );
      return { ...snapshot, mutate: evidence.detailMutate };
    },
    useFetchAuditConversationMessages: (params?: {
      cursor?: string | null;
      includeBody?: boolean;
      limit?: number;
      topicId?: string;
    }) => {
      evidence.messagesLimits.push(params?.limit);
      evidence.messagesCalls.push({
        includeBody: Boolean(params?.includeBody),
        topicId: params?.topicId,
      });
      const entry = params?.topicId ? evidence.messagesByTopic[params.topicId] : undefined;
      // A function entry answers like the server: bodies only when the request asked for them.
      const byTopic =
        typeof entry === 'function' ? entry({ includeBody: Boolean(params?.includeBody) }) : entry;
      if (byTopic) return { ...evidence.messagesSnapshot, data: byTopic, mutate: vi.fn() };
      evidence.messagesCursors.push(params?.cursor ?? null);
      evidence.messagesIncludeBody.push(Boolean(params?.includeBody));
      return {
        ...evidence.messagesSnapshot,
        mutate: vi.fn(),
      };
    },
    useFetchAuditPolicy: () => ({
      data: evidence.policySnapshot.data,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }),
  };
});

vi.mock('../../primitives/AdminPageTemplate', () => ({
  default: ({
    actions,
    banner,
    children,
    title,
  }: {
    actions?: React.ReactNode;
    banner?: React.ReactNode;
    children?: React.ReactNode;
    title?: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <div data-testid="actions">{actions}</div>
      <div data-testid="banner">{banner}</div>
      {children}
    </div>
  ),
}));

vi.mock('../shared/purgeConversationEvidence', () => ({
  purgeAuditConversationEvidenceCaches: () => purgeMock(),
}));

vi.mock('../../primitives/DangerConfirm', () => ({
  openDangerConfirm: (opts: { onConfirm: () => void }) => evidence.confirm(opts),
}));

vi.mock('./ContentAccessDisabledState', () => ({
  default: () => <div data-testid="content-disabled">disabled</div>,
}));

const emitDetail = () => {
  for (const listener of evidence.detailListeners) listener();
};

const GoToTopicB = () => {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate('/admin/audit/conversations/user-1/topics/topic-b')}
    >
      go-topic-b
    </button>
  );
};

const pageTree = () => (
  <MemoryRouter initialEntries={['/admin/audit/conversations/user-1/topics/topic-1']}>
    <Routes>
      <Route
        path="/admin/audit/conversations/:userId/topics/:topicId"
        element={
          <>
            <ConversationTopicPage />
            <GoToTopicB />
          </>
        }
      />
    </Routes>
  </MemoryRouter>
);

const renderPage = () => render(pageTree());

describe('ConversationTopicPage', () => {
  beforeEach(() => {
    evidence.detailMutate.mockReset();
    evidence.toastError.mockReset();
    evidence.confirm.mockReset();
    evidence.messagesCursors.length = 0;
    evidence.messagesIncludeBody.length = 0;
    evidence.messagesLimits.length = 0;
    evidence.messagesByTopic = {};
    evidence.messagesCalls.length = 0;
    purgeMock.mockClear();
    listOlderMock.mockReset();
    evidence.permissions = ['platform_audit:conversation_read:all'];
    evidence.policySnapshot.data = undefined;
    evidence.detailSnapshot = {
      data: {
        agentId: 'agent-1',
        contentAccessMode: 'metadata_only',
        model: 'cached-model',
        provider: 'cached-provider',
        redactionProfile: 'off',
        title: 'Cached topic',
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      error: new Error('detail refresh failed'),
      isLoading: false,
      isValidating: false,
    };
    evidence.messagesSnapshot = {
      data: {
        contentAccessMode: 'metadata_only',
        items: [
          {
            content: 'Cached message evidence',
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            hasContent: true,
            id: 'message-1',
            role: 'user',
          },
        ],
        nextCursor: null,
        redactionProfile: 'off',
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
    };
  });

  it('preserves stale evidence and exposes an episode-deduped detail warning with retry', () => {
    renderPage();

    expect(screen.getByText('Cached topic')).toBeTruthy();
    // metadata_only: the stale turn stays visible, but never its cached body.
    expect(screen.getByText('audit.live.message.bodyHidden')).toBeTruthy();
    expect(screen.queryByText('Cached message evidence')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(
      'audit.conversations.topic.detailUnavailable',
    );
    expect(evidence.toastError).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('audit.shared.retryMissingSections'));
    expect(evidence.detailMutate).toHaveBeenCalledTimes(1);

    act(() => {
      evidence.detailSnapshot = {
        ...evidence.detailSnapshot,
        error: new Error('same failed revalidation episode'),
      };
      emitDetail();
    });
    expect(evidence.toastError).toHaveBeenCalledTimes(1);

    act(() => {
      evidence.detailSnapshot = { ...evidence.detailSnapshot, error: undefined };
      emitDetail();
    });
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => {
      evidence.detailSnapshot = {
        ...evidence.detailSnapshot,
        error: new Error('next failed revalidation episode'),
      };
      emitDetail();
    });
    expect(evidence.toastError).toHaveBeenCalledTimes(2);
    expect(screen.getByText('audit.live.message.bodyHidden')).toBeTruthy();
    expect(screen.queryByText('Cached message evidence')).toBeNull();
  });

  it('keeps provider and model ids model-bank cannot describe', () => {
    const { container } = renderPage();

    expect(container.textContent).toContain('cached-provider · cached-model · agent-1');
  });

  it('shows the agent title and the updated time on one row', () => {
    evidence.detailSnapshot = {
      ...evidence.detailSnapshot,
      data: { ...evidence.detailSnapshot.data, agentTitle: 'Research bot' } as never,
    };
    const { container } = renderPage();

    const row = [...container.querySelectorAll('div')].find((el) =>
      el.textContent?.startsWith('cached-provider · cached-model · Research bot'),
    );
    expect(row?.textContent).toContain('audit.conversations.columns.updatedAt:');
    expect(container.textContent).not.toContain('agent-1');
  });

  it('names the inbox agent with the default-assistant label instead of its id', () => {
    evidence.detailSnapshot = {
      ...evidence.detailSnapshot,
      data: { ...evidence.detailSnapshot.data, agentSlug: 'inbox', agentTitle: null } as never,
    };
    const { container } = renderPage();

    expect(container.textContent).toContain('cached-provider · cached-model · inbox.title');
  });

  it('falls back to the untitled label for a loaded topic without a title', () => {
    evidence.detailSnapshot = {
      ...evidence.detailSnapshot,
      data: { ...evidence.detailSnapshot.data, title: '' },
    };
    renderPage();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'audit.conversations.untitled',
    );
  });

  it('puts the body toggle in the actions, left of Live View, and not in the banner', () => {
    evidence.detailSnapshot = {
      ...evidence.detailSnapshot,
      data: { ...evidence.detailSnapshot.data, contentAccessMode: 'content_allowed' },
      error: undefined,
    };
    evidence.messagesSnapshot.data = {
      ...evidence.messagesSnapshot.data,
      contentAccessMode: 'content_allowed',
    };
    renderPage();

    const actions = screen.getByTestId('actions');
    const toggle = screen.getByRole('checkbox', {
      name: 'audit.conversations.topic.bodyToggleLabel',
    });
    const openLive = screen.getByText('audit.conversations.topic.openLive');
    expect(actions.contains(toggle)).toBe(true);
    expect(
      toggle.compareDocumentPosition(openLive) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId('banner').textContent).toBe('');

    fireEvent.click(toggle);
    expect(evidence.confirm).toHaveBeenCalledTimes(1);
  });

  it('hides already-loaded bodies and resets the reveal when policy flips to metadata_only', () => {
    evidence.detailSnapshot = {
      ...evidence.detailSnapshot,
      data: { ...evidence.detailSnapshot.data, contentAccessMode: 'content_allowed' },
      error: undefined,
    };
    evidence.messagesSnapshot.data = {
      ...evidence.messagesSnapshot.data,
      contentAccessMode: 'content_allowed',
    };
    evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
    const { rerender } = renderPage();

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'audit.conversations.topic.bodyToggleLabel' }),
    );
    expect(evidence.messagesIncludeBody.at(-1)).toBe(true);
    expect(screen.getByText('Cached message evidence')).toBeTruthy();

    // Policy tightens; SWR still holds the bodies fetched under the reveal.
    evidence.messagesSnapshot.data = {
      ...evidence.messagesSnapshot.data,
      contentAccessMode: 'metadata_only',
    };
    act(() => {
      rerender(
        <MemoryRouter initialEntries={['/admin/audit/conversations/user-1/topics/topic-1']}>
          <Routes>
            <Route
              element={<ConversationTopicPage />}
              path="/admin/audit/conversations/:userId/topics/:topicId"
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(screen.queryByText('Cached message evidence')).toBeNull();
    expect(screen.getByText('audit.live.message.bodyHidden')).toBeTruthy();
    expect(evidence.messagesIncludeBody.at(-1)).toBe(false);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('keeps the metadata-only banner and offers no body toggle', () => {
    renderPage();

    expect(screen.getByTestId('banner').textContent).toBe(
      'audit.conversations.topic.metadataOnlyBanner',
    );
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('suppresses cached raw message bodies when detail is strict and messages are off', () => {
    evidence.detailSnapshot = {
      data: {
        ...evidence.detailSnapshot.data,
        contentAccessMode: 'content_allowed',
        redactionProfile: 'strict',
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
    };
    evidence.messagesSnapshot.data = {
      contentAccessMode: 'content_allowed',
      items: [
        {
          content: 'sk-abcdefghijklmnopqrstuvwxyz012345',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          hasContent: true,
          id: 'message-1',
          role: 'user',
        },
      ],
      nextCursor: null,
      redactionProfile: 'off',
    };

    renderPage();

    expect(screen.queryByText('sk-abcdefghijklmnopqrstuvwxyz012345')).toBeNull();
    expect(screen.queryByText('user')).toBeNull();
    expect(screen.queryByText('message-1')).toBeNull();
    expect(screen.getByText('audit.conversations.topic.emptyMessages')).toBeTruthy();
    expect(purgeMock).toHaveBeenCalled();
  });

  it('never renders a detail title secret when messages/policy are strict', () => {
    evidence.permissions = ['platform_audit:conversation_read:all', 'platform_audit:read:all'];
    evidence.policySnapshot.data = { redactionProfile: 'strict' };
    evidence.detailSnapshot = {
      data: {
        ...evidence.detailSnapshot.data,
        contentAccessMode: 'content_allowed',
        redactionProfile: 'off',
        title: SECRET,
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
    };
    evidence.messagesSnapshot.data = {
      contentAccessMode: 'content_allowed',
      items: [
        {
          content: 'visible under strict',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          hasContent: true,
          id: 'message-1',
          role: 'user',
        },
      ],
      nextCursor: null,
      redactionProfile: 'strict',
    };

    renderPage();

    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByText(/cached-provider/)).toBeNull();
    expect(screen.queryByText(/cached-model/)).toBeNull();
    expect(screen.queryByText(/agent-1/)).toBeNull();
    expect(screen.getByText('audit.conversations.topic.title')).toBeTruthy();
    expect(screen.getByText('visible under strict')).toBeTruthy();
  });

  it('disables older-history loading when the messages envelope is rejected', () => {
    evidence.detailSnapshot = {
      data: {
        ...evidence.detailSnapshot.data,
        contentAccessMode: 'content_allowed',
        redactionProfile: 'strict',
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
    };
    evidence.messagesSnapshot.data = {
      contentAccessMode: 'content_allowed',
      items: [
        {
          content: 'sk-abcdefghijklmnopqrstuvwxyz012345',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          hasContent: true,
          id: 'message-1',
          role: 'user',
        },
      ],
      nextCursor: 'msg-c2',
      redactionProfile: 'off',
    };

    renderPage();

    expect(screen.queryByText('audit.live.messages.loadOlder')).toBeNull();
    expect(screen.queryByText('primitives.dataTable.next')).toBeNull();
    expect(listOlderMock).not.toHaveBeenCalled();
    expect(evidence.messagesCursors.every((cursor) => cursor == null)).toBe(true);
  });

  describe('scrolling transcript', () => {
    const msg = (id: string, iso: string, content = `body ${id}`) => ({
      content,
      createdAt: new Date(iso),
      hasContent: true,
      id,
      role: 'user',
    });

    const allowContent = () => {
      evidence.detailSnapshot = {
        ...evidence.detailSnapshot,
        data: { ...evidence.detailSnapshot.data, contentAccessMode: 'content_allowed' },
        error: undefined,
      };
      evidence.messagesSnapshot.data = {
        contentAccessMode: 'content_allowed',
        // Server order: newest first.
        items: [
          msg('m3', '2026-01-02T00:03:00.000Z'),
          msg('m2', '2026-01-02T00:02:00.000Z'),
        ] as never,
        nextCursor: 'cursor-older',
        redactionProfile: 'off',
      };
    };

    const orderOf = (container: HTMLElement, texts: string[]) =>
      texts.map((text) => container.textContent?.indexOf(text) ?? -1);

    it('requests the newest page like the live view and renders it oldest → newest', () => {
      allowContent();
      evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
      const { container } = renderPage();
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'audit.conversations.topic.bodyToggleLabel' }),
      );

      expect(evidence.messagesCursors.every((cursor) => cursor == null)).toBe(true);
      expect(evidence.messagesLimits.at(-1)).toBe(100);
      const [m2, m3] = orderOf(container, ['body m2', 'body m3']);
      expect(m2).toBeGreaterThanOrEqual(0);
      expect(m2).toBeLessThan(m3);
      expect(screen.getByText('audit.live.messages.loadOlder')).toBeTruthy();
    });

    it('prepends an older page above the newest one and follows its cursor', async () => {
      allowContent();
      evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
      listOlderMock.mockResolvedValueOnce({
        contentAccessMode: 'content_allowed',
        items: [msg('m1', '2026-01-02T00:01:00.000Z'), msg('m0', '2026-01-02T00:00:30.000Z')],
        nextCursor: null,
        redactionProfile: 'off',
      });
      const { container } = renderPage();
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'audit.conversations.topic.bodyToggleLabel' }),
      );

      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      await waitFor(() => expect(screen.getByText('body m0')).toBeTruthy());

      expect(listOlderMock).toHaveBeenCalledWith({
        cursor: 'cursor-older',
        includeBody: true,
        limit: 100,
        topicId: 'topic-1',
        userId: 'user-1',
      });
      const positions = orderOf(container, ['body m0', 'body m1', 'body m2', 'body m3']);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      // Oldest page reached: the head shows the start marker instead of the control.
      expect(screen.queryByText('audit.live.messages.loadOlder')).toBeNull();
      expect(screen.getByText('audit.conversations.topic.startOfConversation')).toBeTruthy();
    });

    it('restarts from the newest page when the body toggle flips, discarding older pages', async () => {
      allowContent();
      evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
      listOlderMock.mockResolvedValueOnce({
        contentAccessMode: 'content_allowed',
        items: [msg('m1', '2026-01-02T00:01:00.000Z')],
        nextCursor: 'cursor-oldest',
        redactionProfile: 'off',
      });
      renderPage();
      const toggle = () =>
        screen.getByRole('checkbox', { name: 'audit.conversations.topic.bodyToggleLabel' });

      fireEvent.click(toggle());
      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      await waitFor(() => expect(screen.getByText('body m1')).toBeTruthy());

      fireEvent.click(toggle());
      expect(evidence.messagesIncludeBody.at(-1)).toBe(false);
      expect(evidence.messagesCursors.at(-1)).toBeNull();
      expect(screen.queryByText('body m1')).toBeNull();

      // The next older request starts again from the newest page's cursor, without bodies.
      listOlderMock.mockResolvedValueOnce({
        contentAccessMode: 'content_allowed',
        items: [],
        nextCursor: null,
        redactionProfile: 'off',
      });
      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      await waitFor(() => expect(listOlderMock).toHaveBeenCalledTimes(2));
      expect(listOlderMock.mock.calls[1][0]).toMatchObject({
        cursor: 'cursor-older',
        includeBody: false,
      });
    });

    it('drops an older page that was in flight when the body toggle flipped', async () => {
      allowContent();
      evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
      let resolveOlder: (value: unknown) => void = () => {};
      listOlderMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOlder = resolve;
        }),
      );
      renderPage();
      const toggle = () =>
        screen.getByRole('checkbox', { name: 'audit.conversations.topic.bodyToggleLabel' });

      fireEvent.click(toggle());
      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      fireEvent.click(toggle());

      await act(async () => {
        resolveOlder({
          contentAccessMode: 'content_allowed',
          items: [msg('stale', '2026-01-02T00:00:10.000Z')],
          nextCursor: null,
          redactionProfile: 'off',
        });
      });

      expect(screen.queryByText('body stale')).toBeNull();
      expect(screen.getByText('audit.live.messages.loadOlder')).toBeTruthy();
    });

    it('never paints older-page bodies while policy is not content_allowed', async () => {
      evidence.messagesSnapshot.data = {
        ...evidence.messagesSnapshot.data,
        nextCursor: 'cursor-older',
      };
      listOlderMock.mockResolvedValueOnce({
        contentAccessMode: 'metadata_only',
        items: [msg('m0', '2026-01-01T00:00:00.000Z', 'older cached body')],
        nextCursor: null,
        redactionProfile: 'off',
      });
      renderPage();

      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      await waitFor(() =>
        expect(screen.getAllByText('audit.live.message.bodyHidden')).toHaveLength(2),
      );

      expect(listOlderMock.mock.calls[0][0]).toMatchObject({ includeBody: false });
      expect(screen.queryByText('older cached body')).toBeNull();
      expect(screen.queryByText('Cached message evidence')).toBeNull();
    });

    it('never shows the previous topic’s older pages after navigating to another topic', async () => {
      // Topic A is served strict throughout; topic B is served with redaction off.
      evidence.detailSnapshot = {
        ...evidence.detailSnapshot,
        data: {
          ...evidence.detailSnapshot.data,
          contentAccessMode: 'content_allowed',
          redactionProfile: 'off',
        },
        error: undefined,
      };
      evidence.messagesSnapshot.data = {
        contentAccessMode: 'content_allowed',
        items: [msg('a2', '2026-01-02T00:02:00.000Z')] as never,
        nextCursor: 'cursor-a',
        redactionProfile: 'strict',
      };
      evidence.messagesByTopic['topic-b'] = {
        contentAccessMode: 'content_allowed',
        items: [msg('b1', '2026-01-03T00:00:00.000Z')],
        nextCursor: null,
        redactionProfile: 'off',
      };
      evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
      listOlderMock.mockResolvedValueOnce({
        contentAccessMode: 'content_allowed',
        items: [msg('a1', '2026-01-02T00:01:00.000Z')],
        nextCursor: 'cursor-a-older',
        redactionProfile: 'strict',
      });
      const seen: string[] = [];
      const { container } = renderPage();
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'audit.conversations.topic.bodyToggleLabel' }),
      );
      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      await waitFor(() => expect(screen.getByText('body a1')).toBeTruthy());

      const observer = new MutationObserver(() => seen.push(container.textContent ?? ''));
      observer.observe(container, { characterData: true, childList: true, subtree: true });
      fireEvent.click(screen.getByText('go-topic-b'));
      observer.disconnect();

      expect(seen.some((text) => text.includes('body a1'))).toBe(false);
      expect(screen.queryByText('body a1')).toBeNull();
      // A's strict pages never reached B's fresh redaction authority: B's `off` head renders.
      expect(screen.getByText('body b1')).toBeTruthy();
    });

    it('keeps history whose chain still overlaps a revalidated head', async () => {
      allowContent();
      evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
      listOlderMock.mockResolvedValueOnce({
        contentAccessMode: 'content_allowed',
        items: [msg('m1', '2026-01-02T00:01:00.000Z')],
        nextCursor: null,
        redactionProfile: 'off',
      });
      const { rerender } = renderPage();
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'audit.conversations.topic.bodyToggleLabel' }),
      );
      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      await waitFor(() => expect(screen.getByText('body m1')).toBeTruthy());

      // One new message: the head slides to [m4, m3] — m2 left the head but stays in the chain.
      evidence.messagesSnapshot.data = {
        ...evidence.messagesSnapshot.data,
        items: [
          msg('m4', '2026-01-02T00:04:00.000Z'),
          msg('m3', '2026-01-02T00:03:00.000Z'),
        ] as never,
        nextCursor: 'cursor-m3',
      };
      act(() => {
        rerender(pageTree());
      });

      for (const id of ['m1', 'm2', 'm3', 'm4'])
        expect(screen.getByText(`body ${id}`)).toBeTruthy();
      expect(screen.getByText('audit.conversations.topic.startOfConversation')).toBeTruthy();
    });

    it('restarts from the newest page when a revalidated head no longer connects to the history', async () => {
      allowContent();
      evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
      listOlderMock.mockResolvedValueOnce({
        contentAccessMode: 'content_allowed',
        items: [msg('m1', '2026-01-02T00:01:00.000Z')],
        nextCursor: null,
        redactionProfile: 'off',
      });
      const { rerender } = renderPage();
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'audit.conversations.topic.bodyToggleLabel' }),
      );
      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      await waitFor(() =>
        expect(screen.getByText('audit.conversations.topic.startOfConversation')).toBeTruthy(),
      );

      // Refocus after ≥ one page of new messages: the new head shares nothing with the chain.
      evidence.messagesSnapshot.data = {
        ...evidence.messagesSnapshot.data,
        items: [
          msg('m9', '2026-01-02T00:09:00.000Z'),
          msg('m8', '2026-01-02T00:08:00.000Z'),
        ] as never,
        nextCursor: 'cursor-m8',
      };
      act(() => {
        rerender(pageTree());
      });

      expect(screen.getByText('body m9')).toBeTruthy();
      for (const id of ['m1', 'm2', 'm3']) expect(screen.queryByText(`body ${id}`)).toBeNull();
      // The hole is not passed off as the start of the conversation.
      expect(screen.queryByText('audit.conversations.topic.startOfConversation')).toBeNull();

      listOlderMock.mockResolvedValueOnce({
        contentAccessMode: 'content_allowed',
        items: [],
        nextCursor: null,
        redactionProfile: 'off',
      });
      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      await waitFor(() => expect(listOlderMock).toHaveBeenCalledTimes(2));
      expect(listOlderMock.mock.calls[1][0]).toMatchObject({ cursor: 'cursor-m8' });
    });

    it('never commits bodies from an older fetch that was in flight across a policy downgrade', async () => {
      allowContent();
      evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
      let resolveOlder: (value: unknown) => void = () => {};
      listOlderMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOlder = resolve;
        }),
      );
      const { rerender } = renderPage();
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'audit.conversations.topic.bodyToggleLabel' }),
      );
      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      expect(listOlderMock.mock.calls[0][0]).toMatchObject({ includeBody: true });

      evidence.detailSnapshot = {
        ...evidence.detailSnapshot,
        data: { ...evidence.detailSnapshot.data, contentAccessMode: 'metadata_only' },
      };
      evidence.messagesSnapshot.data = {
        ...evidence.messagesSnapshot.data,
        contentAccessMode: 'metadata_only',
      };
      act(() => {
        rerender(pageTree());
      });
      await act(async () => {
        resolveOlder({
          contentAccessMode: 'content_allowed',
          items: [msg('m1', '2026-01-02T00:01:00.000Z', 'secret older body')],
          nextCursor: null,
          redactionProfile: 'off',
        });
      });

      expect(screen.queryByText('secret older body')).toBeNull();
      expect(screen.queryByText('body m2')).toBeNull();

      // Paging continues metadata-only, never asking for bodies.
      listOlderMock.mockResolvedValueOnce({
        contentAccessMode: 'metadata_only',
        items: [msg('m1', '2026-01-02T00:01:00.000Z', 'secret older body')],
        nextCursor: null,
        redactionProfile: 'off',
      });
      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      await waitFor(() =>
        expect(screen.getAllByText('audit.live.message.bodyHidden')).toHaveLength(3),
      );
      expect(listOlderMock.mock.calls[1][0]).toMatchObject({ includeBody: false });
      expect(screen.queryByText('secret older body')).toBeNull();
    });

    it('strips bodies from an older page whose own envelope is not content_allowed', async () => {
      allowContent();
      evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
      listOlderMock.mockResolvedValueOnce({
        contentAccessMode: 'metadata_only',
        items: [msg('m1', '2026-01-02T00:01:00.000Z', 'leaked older body')],
        nextCursor: null,
        redactionProfile: 'off',
      });
      renderPage();
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'audit.conversations.topic.bodyToggleLabel' }),
      );
      fireEvent.click(screen.getByText('audit.live.messages.loadOlder'));
      await waitFor(() =>
        expect(screen.getByText('audit.conversations.topic.startOfConversation')).toBeTruthy(),
      );

      expect(screen.queryByText('leaked older body')).toBeNull();
      // Newest page stays as served under content_allowed.
      expect(screen.getByText('body m3')).toBeTruthy();
    });

    it('turns the body reveal off when navigating to another topic', () => {
      allowContent();
      evidence.detailSnapshot = {
        ...evidence.detailSnapshot,
        data: { ...evidence.detailSnapshot.data, redactionProfile: 'off' },
      };
      evidence.messagesByTopic['topic-b'] = ({ includeBody }: { includeBody: boolean }) => ({
        contentAccessMode: 'content_allowed',
        items: [
          {
            ...msg('b1', '2026-01-03T00:00:00.000Z'),
            content: includeBody ? 'body b1' : null,
          },
        ],
        nextCursor: null,
        redactionProfile: 'off',
      });
      evidence.confirm.mockImplementation((opts: { onConfirm: () => void }) => opts.onConfirm());
      renderPage();
      const toggle = () =>
        screen.getByRole('checkbox', {
          name: 'audit.conversations.topic.bodyToggleLabel',
        }) as HTMLInputElement;

      fireEvent.click(toggle());
      expect(toggle().checked).toBe(true);
      expect(evidence.messagesCalls.at(-1)).toEqual({ includeBody: true, topicId: 'topic-1' });

      fireEvent.click(screen.getByText('go-topic-b'));

      const topicBCalls = evidence.messagesCalls.filter((call) => call.topicId === 'topic-b');
      expect(topicBCalls[0]).toEqual({ includeBody: false, topicId: 'topic-b' });
      expect(topicBCalls.every((call) => !call.includeBody)).toBe(true);
      expect(screen.queryByText('body b1')).toBeNull();
      expect(toggle().checked).toBe(false);
      // Revealing B's bodies needs its own confirmation.
      expect(evidence.confirm).toHaveBeenCalledTimes(1);
    });
  });
});
