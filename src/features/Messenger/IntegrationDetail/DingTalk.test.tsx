import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DingTalkDetail from './DingTalk';

interface LinkRow {
  activeAgentId: string | null;
  createdAt: Date | string | null;
  platform: string;
  platformUserId: string;
  platformUsername: string | null;
  workspaceId: string | null;
}

const state = vi.hoisted(() => ({ links: [] as unknown[] }));

const userState = {
  isSignedIn: true,
  user: {
    avatar: 'user-avatar',
    email: 'demo@example.com',
    fullName: 'Demo Name',
    username: 'demo-user',
  },
};

const COPY: Record<string, string> = {
  'messenger.detail.connections.connected': '已连接',
  'messenger.dingtalk.agent.hint':
    '来自钉钉的消息将由该助手回复，也可在对话中发送 /助手 随时切换。',
  'messenger.dingtalk.agent.label': '默认助手',
  'messenger.dingtalk.capabilities.chatDisabled': '管理员已关闭对话能力',
  'messenger.dingtalk.capabilities.pushDisabled': '管理员已关闭提醒推送',
  'messenger.dingtalk.commands.agents': '列出并切换助手',
  'messenger.dingtalk.commands.aliasNote':
    '同时支持英文别名：/agents /use /new /topics /resume /status /stop /help。',
  'messenger.dingtalk.commands.commandHeader': '指令',
  'messenger.dingtalk.commands.descriptionHeader': '说明',
  'messenger.dingtalk.commands.groupNote': '群聊中需 @机器人 发起对话，且每位成员的会话相互独立。',
  'messenger.dingtalk.commands.help': '查看全部指令',
  'messenger.dingtalk.commands.new': '开启新会话',
  'messenger.dingtalk.commands.resume': '继续第 N 个会话',
  'messenger.dingtalk.commands.status': '查看当前助手与会话',
  'messenger.dingtalk.commands.stop': '停止当前执行',
  'messenger.dingtalk.commands.title': '用法',
  'messenger.dingtalk.commands.topics': '列出最近会话',
  'messenger.dingtalk.commands.use': '切换到第 N 个助手',
  'messenger.dingtalk.status.accountLabel': '钉钉账号',
  'messenger.dingtalk.status.chatUnavailable': '对话功能不可用',
  'messenger.dingtalk.status.instructions':
    '在钉钉中找到机器人「{{botName}}」并发送任意消息，即可自动完成绑定。',
  'messenger.dingtalk.status.linkedAt': '绑定于 {{time}}',
  'messenger.dingtalk.status.notStarted': '尚未开始对话',
  'messenger.dingtalk.status.title': '绑定状态',
  'messenger.scope': '归属',
  'messenger.scopePersonal': '个人',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const template = COPY[key] ?? (values as { defaultValue?: string })?.defaultValue ?? key;
      if (!values) return template;
      return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) =>
        values[name] === undefined ? `{{${name}}}` : String(values[name]),
      );
    },
  }),
}));

vi.mock('swr', () => ({
  default: (key: unknown) => {
    const root = Array.isArray(key) ? key[0] : key;
    if (root === 'messenger:listMyLinks')
      return { data: state.links, error: undefined, isLoading: false, mutate: vi.fn() };
    if (root === 'messenger:listMyInstallations')
      return { data: [], error: undefined, isLoading: false, mutate: vi.fn() };
    return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
  },
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar }: { avatar?: string }) => <span data-avatar={avatar} />,
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => <span />,
  Skeleton: Object.assign(() => <span />, {
    Avatar: () => <span />,
    Button: () => <span />,
  }),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: vi.fn(),
  Select: ({ options }: { options?: { label: ReactNode; value: string }[] }) => (
    <div data-testid="scope-select">
      {(options ?? []).map((option) => (
        <div data-testid={`scope-option-${option.value}`} key={option.value}>
          {option.label}
        </div>
      ))}
    </div>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/icons', () => {
  const brand = Object.assign(() => <span />, {
    Avatar: () => <span data-testid="platform-avatar" />,
    Color: () => <span />,
  });
  return { DingTalk: brand, Discord: brand, Slack: brand, Telegram: brand };
});

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: vi.fn(), success: vi.fn() } }) },
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () =>
    new Proxy({} as Record<string, string>, { get: (_target, prop) => String(prop) }),
}));

vi.mock('@/components/AsyncError', () => ({
  default: () => <div data-testid="async-error" />,
}));

vi.mock('@/enterprise/client/providers/RuntimeBrandingProvider', () => ({
  useBranding: () => ({ name: 'AIHub' }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/services/messenger', () => ({
  messengerService: {
    listBindingScopes: vi.fn(),
    setActiveAgent: vi.fn(),
    unlink: vi.fn(),
  },
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { enableBusinessFeatures: () => true },
  useServerConfigStore: (
    selector: (state: { featureFlags: { enableWorkspace: boolean } }) => unknown,
  ) => selector({ featureFlags: { enableWorkspace: true } }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof userState) => unknown) => selector(userState),
}));

// Leaf picker only — the scope row above it comes from the real AgentScopeSelect.
vi.mock('../AgentSelect', () => ({
  default: () => <div data-testid="agent-select" />,
}));

const linkedRow: LinkRow = {
  activeAgentId: 'agent-1',
  // Local time on purpose: `formatLinkedAt` renders in the browser timezone, so
  // a UTC instant would drift across the date boundary on some hosts.
  createdAt: new Date(2026, 8, 15, 10, 30),
  platform: 'dingtalk',
  platformUserId: 'staff-8899',
  platformUsername: null,
  workspaceId: null,
};

const renderDetail = (props: Partial<Parameters<typeof DingTalkDetail>[0]> = {}) =>
  render(<DingTalkDetail name="钉钉" onBack={vi.fn()} {...props} />);

describe('Messenger DingTalkDetail', () => {
  beforeEach(() => {
    state.links = [];
  });

  it('shows the auto-link instructions with the robot name when no link exists', () => {
    renderDetail({ botUsername: 'AIHub 助手' });

    expect(screen.getByText('尚未开始对话')).toBeInTheDocument();
    expect(
      screen.getByText('在钉钉中找到机器人「AIHub 助手」并发送任意消息，即可自动完成绑定。'),
    ).toBeInTheDocument();
    // No connect / verify flow exists for DingTalk.
    expect(screen.queryByTestId('agent-select')).not.toBeInTheDocument();
  });

  it('falls back to the app name when the robot name is unknown', () => {
    renderDetail();

    expect(
      screen.getByText('在钉钉中找到机器人「AIHub」并发送任意消息，即可自动完成绑定。'),
    ).toBeInTheDocument();
  });

  it('replaces the bind instruction with the disabled notice when chat is off', () => {
    renderDetail({ botUsername: 'AIHub 助手', capabilities: { chat: false, push: true } });

    expect(screen.getByText('对话功能不可用')).toBeInTheDocument();
    expect(screen.getByText('管理员已关闭对话能力')).toBeInTheDocument();
    expect(screen.queryByText('尚未开始对话')).not.toBeInTheDocument();
    expect(
      screen.queryByText('在钉钉中找到机器人「AIHub 助手」并发送任意消息，即可自动完成绑定。'),
    ).not.toBeInTheDocument();
  });

  it('shows the linked account, linked time, scope row and the agent picker once linked', () => {
    state.links = [linkedRow];
    renderDetail({ botUsername: 'AIHub 助手' });

    expect(screen.getByText('钉钉账号')).toBeInTheDocument();
    expect(screen.getByText('staff-8899')).toBeInTheDocument();
    expect(screen.getByText('已连接')).toBeInTheDocument();
    expect(screen.getByText('绑定于 2026-09-15 10:30')).toBeInTheDocument();
    expect(screen.getByText('默认助手')).toBeInTheDocument();
    expect(screen.getByTestId('agent-select')).toBeInTheDocument();
    // Workspace scope picker, so a workspace agent can be chosen from settings.
    expect(screen.getByTestId('scope-select')).toBeInTheDocument();
    expect(screen.getByTestId('scope-option-personal')).toBeInTheDocument();
    expect(screen.queryByText('尚未开始对话')).not.toBeInTheDocument();
  });

  it('renders the command table with the Chinese commands and their descriptions', () => {
    renderDetail();

    expect(screen.getByText('用法')).toBeInTheDocument();
    const rows: [string, string][] = [
      ['/助手', '列出并切换助手'],
      ['/切换 N', '切换到第 N 个助手'],
      ['/新会话', '开启新会话'],
      ['/会话', '列出最近会话'],
      ['/继续 N', '继续第 N 个会话'],
      ['/当前', '查看当前助手与会话'],
      ['/停止', '停止当前执行'],
      ['/帮助', '查看全部指令'],
    ];
    for (const [command, description] of rows) {
      expect(screen.getByText(command)).toBeInTheDocument();
      expect(screen.getByText(description)).toBeInTheDocument();
    }
    expect(
      screen.getByText('同时支持英文别名：/agents /use /new /topics /resume /status /stop /help。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('群聊中需 @机器人 发起对话，且每位成员的会话相互独立。'),
    ).toBeInTheDocument();
  });

  it('explains which half the administrator disabled', () => {
    state.links = [linkedRow];
    renderDetail({ capabilities: { chat: false, push: false } });

    expect(screen.getByText('管理员已关闭对话能力')).toBeInTheDocument();
    expect(screen.getByText('管理员已关闭提醒推送')).toBeInTheDocument();
  });

  it('hides the capability notices when both halves are enabled', () => {
    state.links = [linkedRow];
    renderDetail({ capabilities: { chat: true, push: true } });

    expect(screen.queryByText('管理员已关闭对话能力')).not.toBeInTheDocument();
    expect(screen.queryByText('管理员已关闭提醒推送')).not.toBeInTheDocument();
  });
});
