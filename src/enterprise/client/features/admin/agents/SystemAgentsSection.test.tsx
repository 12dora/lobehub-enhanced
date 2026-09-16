// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type SystemAgentPinProps, SystemAgentsSection } from './SystemAgentsSection';
import type { AdminSystemAgentSnapshot } from './useTaskManagerAgent';

const brandingMock = vi.hoisted(() => ({
  value: { iconUrl: null, logoUrl: null, publishedRevision: null } as Record<string, unknown>,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// The real avatar resolver runs; only the published brand it reads is supplied here.
vi.mock('@/enterprise/client/providers/RuntimeBrandingProvider', () => ({
  useBranding: () => brandingMock.value,
}));
vi.mock('@/hooks/useCurrentInboxAgent', () => ({ useCurrentInboxAgentMeta: () => undefined }));
vi.mock('antd-style', () => ({
  createStaticStyles: () => new Proxy({}, { get: (_t, key) => String(key) }),
  cssVar: new Proxy({}, { get: (_t, key) => `var(--${String(key)})` }),
}));
vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Avatar: ({ avatar }: { avatar?: string }) => <img alt="avatar" src={avatar} />,
  Button: ({ children, loading, ...props }: any) => (
    <button data-loading={String(Boolean(loading))} {...props}>
      {children}
    </button>
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children, type }: { children?: ReactNode; type?: string }) => (
    <span data-type={type}>{children}</span>
  ),
}));
// The default card deliberately shows no status; the marker below is what proves it.
vi.mock('../primitives/StatusBadge', () => ({
  default: ({ status }: { status?: string }) => <span>status:{status}</span>,
}));

const snapshot = (
  avatar: string | null = '🤖',
  over: Partial<AdminSystemAgentSnapshot['item']['identity']> = {},
): AdminSystemAgentSnapshot =>
  ({
    detail: {
      identity: { currentVersionId: 'version-1', id: 'agent-inbox' },
      versions: [
        {
          config: { avatar, backgroundColor: '#222' },
          dependencySnapshot: { model: { modelKey: 'gpt-4o-mini', providerKey: 'openai' } },
          id: 'version-1',
        },
      ],
    },
    item: {
      displayName: 'Company assistant',
      identity: { currentVersionId: 'version-1', id: 'agent-inbox', status: 'published', ...over },
      publishedVersion: '1.2.0',
    },
  }) as never;

const taskSnapshot = (
  over: Partial<AdminSystemAgentSnapshot['item']['identity']> = {},
): AdminSystemAgentSnapshot =>
  ({
    detail: {
      identity: { currentVersionId: 'version-task', id: 'agent-task-manager' },
      versions: [
        {
          config: { avatar: '🗂️', backgroundColor: '#123' },
          dependencySnapshot: { model: { modelKey: 'gpt-4o-mini', providerKey: 'openai' } },
          id: 'version-task',
        },
      ],
    },
    item: {
      displayName: '任务助手（已托管）',
      identity: {
        currentVersionId: 'version-task',
        id: 'agent-task-manager',
        status: 'published',
        ...over,
      },
      publishedVersion: '1.0.0',
    },
  }) as never;

const pin = (over: Partial<SystemAgentPinProps> = {}): SystemAgentPinProps => ({
  canEdit: false,
  canProvision: true,
  error: undefined,
  onEdit: vi.fn(),
  onProvision: vi.fn(),
  onRetry: vi.fn(),
  provisionFailed: false,
  provisioning: false,
  snapshot: snapshot(),
  ...over,
});

const renderSection = (
  defaultInbox: Partial<SystemAgentPinProps> = {},
  taskManager: Partial<SystemAgentPinProps> = {},
) =>
  render(
    <SystemAgentsSection
      defaultInbox={pin(defaultInbox)}
      taskManager={pin({ snapshot: taskSnapshot(), ...taskManager })}
    />,
  );

/** The two pinned cards, in render order: 默认助理 first, 任务助手 second. */
const cards = () => Array.from(document.querySelectorAll('section'));
const inboxCard = () => cards()[0]!;
const taskCard = () => cards()[1]!;

describe('SystemAgentsSection', () => {
  beforeEach(() => {
    brandingMock.value = { iconUrl: null, logoUrl: null, publishedRevision: null };
  });

  it('pins both reserved assistants, each under its own heading', () => {
    renderSection();

    expect(cards()).toHaveLength(2);
    expect(within(inboxCard()).getByText('agentCatalog.defaultAgent.title')).toBeTruthy();
    expect(within(taskCard()).getByText('agentCatalog.taskManagerAgent.title')).toBeTruthy();
    expect(within(taskCard()).getByText('任务助手（已托管）')).toBeTruthy();
    expect(within(taskCard()).getByText('agentCatalog.taskManagerAgent.description')).toBeTruthy();
  });

  // The card must agree with what members are actually shown, not with the raw stored value.
  it('renders the default assistant’s built-in avatar the way members see it', () => {
    brandingMock.value = {
      iconUrl: 'https://brand.example.com/icon.png',
      logoUrl: null,
      publishedRevision: 4,
    };
    const { unmount } = renderSection({ snapshot: snapshot('/avatars/lobe-ai.png') });
    expect(within(inboxCard()).getByAltText('avatar').getAttribute('src')).toBe(
      'https://brand.example.com/icon.png',
    );
    unmount();

    // An avatar the admin chose is never replaced by the brand.
    renderSection({ snapshot: snapshot('🤖') });
    expect(within(inboxCard()).getByAltText('avatar').getAttribute('src')).toBe('🤖');
  });

  it('falls back to the built-in inbox image when nothing is set and no brand is published', () => {
    renderSection({ snapshot: snapshot(null) });
    expect(within(inboxCard()).getByAltText('avatar').getAttribute('src')).toBe(
      '/avatars/lobe-ai.png',
    );
  });

  // The task assistant is NOT the inbox: the brand icon must never stand in for its avatar.
  it('reads the task assistant’s avatar from its own published version', () => {
    brandingMock.value = {
      iconUrl: 'https://brand.example.com/icon.png',
      logoUrl: null,
      publishedRevision: 4,
    };
    renderSection();
    expect(within(taskCard()).getByAltText('avatar').getAttribute('src')).toBe('🗂️');
  });

  it('renders the default assistant without a version or a status anywhere on its card', () => {
    renderSection();
    const card = within(inboxCard());

    expect(card.getByText('Company assistant')).toBeTruthy();
    // The avatar still comes from the current version…
    expect(card.getByAltText('avatar').getAttribute('src')).toBe('🤖');
    // …but saving IS publishing, so there is no version for an admin to reason about.
    expect(card.queryByText('1.2.0')).toBeNull();
    // The card is always the published default: a status tag states the obvious, and the model is
    // an editor-level detail. Neither belongs on the pinned summary.
    expect(card.queryByText('status:published')).toBeNull();
    expect(card.queryByText('openai · gpt-4o-mini')).toBeNull();
  });

  // The task assistant CAN be absent or half-published, so its card says which it is.
  it('states the task assistant’s catalog status', () => {
    const { unmount } = renderSection();
    expect(within(taskCard()).getByText('status:published')).toBeTruthy();
    unmount();

    renderSection({}, { snapshot: taskSnapshot({ status: 'draft' }) });
    expect(within(taskCard()).getByText('status:draft')).toBeTruthy();
  });

  // Dropping the two removed lines must not leave a gap under the name: what the default
  // assistant is reads as the identity's own second line, below the name.
  it('reads the description as the second line of the identity, not as a card caption', () => {
    renderSection();

    const description = within(inboxCard()).getByText('agentCatalog.defaultAgent.description');
    const identity = description.parentElement;
    expect(identity?.className).toBe('identity');
    expect(identity?.textContent).toBe('Company assistantagentCatalog.defaultAgent.description');
    // The heading still names the card, once.
    expect(screen.getAllByText('agentCatalog.defaultAgent.title')).toHaveLength(1);
  });

  it('says the default is being prepared instead of offering a takeover step', () => {
    renderSection({ snapshot: null });

    expect(within(inboxCard()).getByText('agentCatalog.defaultAgent.preparing')).toBeTruthy();
    expect(within(inboxCard()).queryByRole('button')).toBeNull();
  });

  // The built-in task agent still answers while the platform has not taken the managed one over,
  // so this is a choice an admin makes, not a repair that must happen behind their back.
  it('offers the takeover when the task assistant is not managed yet', () => {
    const onProvision = vi.fn();
    renderSection({}, { onProvision, snapshot: null });
    const card = within(taskCard());

    expect(card.getByText('agentCatalog.taskManagerAgent.unmanaged')).toBeTruthy();
    expect(card.queryByText('agentCatalog.taskManagerAgent.preparing')).toBeNull();
    fireEvent.click(card.getByText('agentCatalog.taskManagerAgent.provision.action'));
    expect(onProvision).toHaveBeenCalledOnce();
  });

  it('keeps the takeover button busy while the write is in flight', () => {
    renderSection({}, { provisioning: true, snapshot: null });
    expect(
      within(taskCard())
        .getByText('agentCatalog.taskManagerAgent.provision.action')
        .getAttribute('data-loading'),
    ).toBe('true');
  });

  it('owns the failure of the automatic initialization, with a retry', () => {
    const onProvision = vi.fn();
    renderSection({ onProvision, provisionFailed: true, snapshot: null });

    expect(within(inboxCard()).getByText('agentCatalog.defaultAgent.provision.error')).toBeTruthy();
    fireEvent.click(within(inboxCard()).getByText('agentCatalog.dependency.retry'));
    expect(onProvision).toHaveBeenCalledOnce();
  });

  it('owns a failed task-assistant takeover on its own card', () => {
    const onProvision = vi.fn();
    renderSection({}, { onProvision, provisionFailed: true, snapshot: null });
    const card = within(taskCard());

    expect(card.getByText('agentCatalog.taskManagerAgent.provision.error')).toBeTruthy();
    // The failed state replaces the takeover CTA with a retry, so nothing offers two entry points.
    expect(card.queryByText('agentCatalog.taskManagerAgent.provision.action')).toBeNull();
    fireEvent.click(card.getByText('agentCatalog.dependency.retry'));
    expect(onProvision).toHaveBeenCalledOnce();
  });

  it('keeps the failure on screen while the retry runs', () => {
    renderSection({ provisionFailed: true, provisioning: true, snapshot: null });

    const card = within(inboxCard());
    expect(card.getByText('agentCatalog.defaultAgent.provision.error')).toBeTruthy();
    expect(card.getByText('agentCatalog.dependency.retry').getAttribute('data-loading')).toBe(
      'true',
    );
  });

  // `canProvision` is the whole create + publish + assign compound, so this is also the operator
  // who may create ordinary assistants but not the reserved ones: no retry, nothing in flight.
  it('points an operator who cannot initialize a system assistant at someone who can', () => {
    renderSection({ canProvision: false, snapshot: null }, { canProvision: false, snapshot: null });

    expect(
      within(inboxCard()).getByText('agentCatalog.defaultAgent.provision.readOnly'),
    ).toBeTruthy();
    expect(
      within(taskCard()).getByText('agentCatalog.taskManagerAgent.provision.readOnly'),
    ).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('opens the editor for whichever system assistant was clicked', () => {
    const onEditInbox = vi.fn();
    const onEditTask = vi.fn();
    renderSection({ canEdit: true, onEdit: onEditInbox }, { canEdit: true, onEdit: onEditTask });

    fireEvent.click(within(inboxCard()).getByText('agentCatalog.action.edit'));
    expect(onEditInbox).toHaveBeenCalledWith('agent-inbox');

    fireEvent.click(within(taskCard()).getByText('agentCatalog.action.edit'));
    expect(onEditTask).toHaveBeenCalledWith('agent-task-manager');
  });

  it('never claims a system assistant is missing while its read has not settled', () => {
    const { unmount } = renderSection({ snapshot: undefined }, { snapshot: undefined });
    expect(within(inboxCard()).getByText('agentCatalog.defaultAgent.loading')).toBeTruthy();
    expect(within(taskCard()).getByText('agentCatalog.taskManagerAgent.loading')).toBeTruthy();
    expect(screen.queryByText('agentCatalog.taskManagerAgent.provision.action')).toBeNull();
    unmount();

    renderSection(
      { error: new Error('offline'), snapshot: undefined },
      { error: new Error('offline'), snapshot: undefined },
    );
    expect(within(inboxCard()).getAllByText('agentCatalog.defaultAgent.loadError').length).toBe(1);
    expect(within(inboxCard()).queryByText('agentCatalog.defaultAgent.preparing')).toBeNull();
    expect(within(taskCard()).queryByText('agentCatalog.taskManagerAgent.unmanaged')).toBeNull();
  });

  // A failed revalidation on top of a settled read must not hide the assistant members already
  // use; it says the card may be behind and offers the retry.
  it('keeps a settled card on screen when a revalidation fails, with a retry', () => {
    const onRetry = vi.fn();
    renderSection({}, { error: new Error('offline'), onRetry });
    const card = within(taskCard());

    expect(card.getByText('任务助手（已托管）')).toBeTruthy();
    expect(card.getByText('agentCatalog.taskManagerAgent.loadError')).toBeTruthy();
    fireEvent.click(card.getByText('agentCatalog.dependency.retry'));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
