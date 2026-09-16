/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentSelectorAction from './AgentSelectorAction';

const mocks = vi.hoisted(() => ({
  agentState: {
    agentMap: {
      agt_task: {
        avatar: 'task-avatar',
        description: 'Task manager',
        title: '' as string,
      },
    },
    builtinAgentIdMap: {
      'task-agent': 'agt_task',
    },
  },
  conversationState: {
    context: {
      agentId: 'agt_task',
    },
  },
  fetchAgentList: vi.fn(),
  homeState: {
    agentGroups: [] as any[],
    isAgentListInit: true,
    pinnedAgents: [] as any[],
    privateAgentGroups: [] as any[],
    privateUngroupedAgents: [] as any[],
    ungroupedAgents: [
      { id: 'agt_custom', title: 'Custom Agent', type: 'agent' },
      { id: 'grp_custom', title: 'Custom Group', type: 'group' },
    ],
  },
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({ children }: { children: ReactNode }) => (
    <div data-testid="selector-trigger">{children}</div>
  ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({
    children,
    content,
    onOpenChange,
  }: {
    children: ReactNode;
    content: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
      <button data-testid="open-popover" onClick={() => onOpenChange?.(true)}>
        {children}
      </button>
      <div data-testid="popover-content">{content}</div>
    </div>
  ),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    chevron: 'chevron',
    container: 'container',
  }),
  cx: (...classes: string[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('lucide-react', () => ({
  ChevronsUpDownIcon: () => <span data-testid="chevron" />,
  Circle: () => <span data-testid="circle" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'taskManager.agent' ? 'Task Manager' : key),
  }),
}));

vi.mock('@/features/Conversation', () => ({
  conversationSelectors: {
    agentId: (state: typeof mocks.conversationState) => state.context.agentId,
  },
  useConversationStore: (selector: (state: typeof mocks.conversationState) => unknown) =>
    selector(mocks.conversationState),
}));

vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => <div data-testid="skeleton" />,
}));

vi.mock('@/features/PageEditor/Copilot/AgentSelector/AgentItem', () => ({
  default: ({
    agentId,
    agentTitle,
    onAgentChange,
  }: {
    agentId: string;
    agentTitle: string;
    onAgentChange: (id: string) => void;
  }) => (
    <button data-agent-id={agentId} onClick={() => onAgentChange(agentId)}>
      {agentTitle}
    </button>
  ),
}));

vi.mock('@/hooks/useFetchAgentList', () => ({
  useFetchAgentList: () => mocks.fetchAgentList(),
}));

vi.mock('@/routes/(main)/home/_layout/Body/Agent/List/AgentItem/Avatar', () => ({
  default: ({ avatar }: { avatar?: string }) => <span data-avatar={avatar} data-testid="avatar" />,
}));

vi.mock('@/routes/(main)/home/_layout/Body/Agent/ModalProvider', () => ({
  AgentModalProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: typeof mocks.homeState) => unknown) => selector(mocks.homeState),
}));

describe('AgentSelectorAction', () => {
  beforeEach(() => {
    mocks.fetchAgentList.mockClear();
    mocks.conversationState.context.agentId = 'agt_task';
    mocks.homeState.isAgentListInit = true;
    mocks.homeState.ungroupedAgents = [
      { id: 'agt_custom', title: 'Custom Agent', type: 'agent' },
      { id: 'grp_custom', title: 'Custom Group', type: 'group' },
    ];
    mocks.agentState.agentMap.agt_task.title = '';
  });

  it('adds the builtin task agent and filters out group sessions', () => {
    render(<AgentSelectorAction onAgentChange={vi.fn()} />);

    expect(mocks.fetchAgentList).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('Task Manager');
    expect(document.body.textContent).toContain('Custom Agent');
    expect(document.body.textContent).not.toContain('Custom Group');
  });

  it('uses the active agent avatar and forwards agent changes', () => {
    const onAgentChange = vi.fn();
    const { getByText, getByTestId } = render(
      <AgentSelectorAction onAgentChange={onAgentChange} />,
    );

    expect(getByTestId('avatar').dataset.avatar).toBe('task-avatar');

    fireEvent.click(getByText('Custom Agent'));
    expect(onAgentChange).toHaveBeenCalledWith('agt_custom');
  });

  // The task assistant is platform-managed now: once an admin names it in 助理管理, the server
  // overlay puts that name on the agent row, and the picker must show what members actually get.
  it('shows the managed identity name for the builtin task agent', () => {
    mocks.agentState.agentMap.agt_task.title = '客服任务助手';

    render(<AgentSelectorAction onAgentChange={vi.fn()} />);

    expect(document.body.textContent).toContain('客服任务助手');
    expect(document.body.textContent).not.toContain('Task Manager');
  });

  it('falls back to the shipped label while the platform has not named it', () => {
    mocks.agentState.agentMap.agt_task.title = '';

    render(<AgentSelectorAction onAgentChange={vi.fn()} />);

    expect(document.body.textContent).toContain('Task Manager');
  });

  it('overlays the managed identity onto the task agent the home list already carries', () => {
    mocks.agentState.agentMap.agt_task.title = '客服任务助手';
    mocks.homeState.ungroupedAgents = [
      { id: 'agt_task', title: 'Task Manager From Home', type: 'agent' },
      { id: 'agt_custom', title: 'Custom Agent', type: 'agent' },
    ];

    const { getByTestId } = render(<AgentSelectorAction onAgentChange={vi.fn()} />);

    // The home list is not overlayed — it carries the raw row — so the admin's identity has to be
    // applied on this path too, or exactly the members who already have the assistant listed keep
    // seeing the shipped name. It must still appear once.
    expect(document.body.textContent).toContain('客服任务助手');
    expect(document.body.textContent).not.toContain('Task Manager From Home');
    expect(document.body.textContent).toContain('Custom Agent');
    expect(getByTestId('avatar').dataset.avatar).toBe('task-avatar');
  });

  it('keeps the home-list title while the platform has not named the task agent', () => {
    mocks.homeState.ungroupedAgents = [
      { id: 'agt_task', title: 'Task Manager From Home', type: 'agent' },
    ];

    render(<AgentSelectorAction onAgentChange={vi.fn()} />);

    expect(document.body.textContent).toContain('Task Manager From Home');
    expect(document.body.textContent).not.toContain('Task ManagerTask Manager');
  });
});
