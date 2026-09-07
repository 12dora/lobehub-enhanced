/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ZodModule from 'zod';

import type { AdminToolScope } from '@/features/AdminToolScope';
import { AdminToolScopeProvider } from '@/features/AdminToolScope';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import SkillDetail from './index';

vi.mock('zod', async (importOriginal) => {
  const actual = await importOriginal<typeof ZodModule>();
  return { ...actual, z: actual.z ?? actual.default };
});

const mocks = vi.hoisted(() => {
  const toolState = {
    agentSkills: [] as Array<{ id: string; identifier: string; name: string }>,
    builtinSkills: [] as Array<{
      content?: string;
      description?: string;
      identifier: string;
      name: string;
    }>,
    disabledSkillIdentifiers: [] as string[],
    checkLobehubSkillStatus: vi.fn(),
    composioServers: [] as Array<{ identifier: string; status: string }>,
    connectors: [] as Array<{ id: string; identifier: string }>,
    createComposioConnection: vi.fn(),
    deleteAgentSkill: vi.fn(),
    fetchConnectors: vi.fn(),
    getLobehubSkillAuthorizeUrl: vi.fn(),
    installBuiltinTool: vi.fn(),
    installedBuiltinIds: [] as string[],
    lobehubSkillServers: [] as Array<{
      identifier: string;
      isConnected: boolean;
      name: string;
      status: string;
      tools?: Array<{
        description?: string;
        inputSchema: Record<string, unknown>;
        name: string;
      }>;
    }>,
    refreshComposioConnectionStatus: vi.fn(),
    removeComposioConnection: vi.fn(),
    revokeLobehubSkill: vi.fn(),
    syncBuiltinTool: vi.fn(),
    syncPluginTools: vi.fn(),
    syncToolsFromClient: vi.fn(),
    uninstallBuiltinTool: vi.fn(),
  };

  function selectToolStore<T>(selector: (state: typeof toolState) => T): T {
    return selector(toolState);
  }

  const useToolStoreWithState = Object.assign(vi.fn(selectToolStore), {
    getState: vi.fn(() => toolState),
  });

  return {
    confirmModal: vi.fn(),
    permissions: {
      create_content: true,
      edit_own_content: true,
    },
    toolState,
    useToolStore: useToolStoreWithState,
    userState: { userId: 'user-id' },
  };
});

vi.mock('@lobechat/const', () => ({
  COMPOSIO_APP_TYPES: [],
  getLobehubSkillProviderById: (identifier: string) =>
    identifier === 'notion'
      ? {
          label: 'Notion',
        }
      : undefined,
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: () => <div data-testid="avatar" />,
  Markdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Skeleton: () => <div data-testid="skeleton" />,
}));

// Stub the base-ui Button to a native button — it needs a MotionProvider the
// app sets up globally but the unit env doesn't.
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  confirmModal: mocks.confirmModal,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: (
    creator: (tokens: {
      css: () => string;
      cssVar: Record<string, string>;
    }) => Record<string, string>,
  ) =>
    creator({
      css: () => '',
      cssVar: {
        colorBorderSecondary: 'colorBorderSecondary',
        colorText: 'colorText',
        colorTextSecondary: 'colorTextSecondary',
        colorTextTertiary: 'colorTextTertiary',
      },
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; name?: string } | string) => {
      const translations: Record<string, string> = {
        'tools.lobehubSkill.connect': 'Connect',
        'tools.lobehubSkill.disconnect': 'Disconnect',
        'tools.lobehubSkill.disconnectConfirm.desc': `Disconnect ${(options as { name?: string })?.name}?`,
        'tools.lobehubSkill.disconnectConfirm.title': `Disconnect ${(options as { name?: string })?.name}`,
        'tools.noConfigurablePermissions':
          'This skill does not expose configurable tool permissions.',
      };

      if (translations[key]) return translations[key];
      if (typeof options === 'object' && options?.defaultValue) return options.defaultValue;

      return key;
    },
  }),
}));

vi.mock('@/features/AgentSkillDetail', () => ({
  default: () => <div data-testid="agent-skill-detail" />,
}));

vi.mock('@/features/SkillEnabledSwitch', () => ({
  default: ({
    checked,
    disabled,
    identifier,
    kind,
    label,
    onToggle,
  }: {
    checked?: boolean;
    disabled?: boolean;
    identifier: string;
    kind: 'builtin' | 'skill';
    label?: string;
    onToggle?: (enabled: boolean) => void;
  }) => (
    <div
      data-checked={String(checked)}
      data-disabled={String(disabled)}
      data-identifier={identifier}
      data-kind={kind}
      data-label={label}
      data-testid="skill-enabled-switch"
      onClick={() => onToggle?.(false)}
    />
  ),
}));

// The distribution control pulls in @lobehub/ui components this suite stubs out.
vi.mock('@/features/AdminToolScope/AdminBuiltinSkillDistribution', () => ({
  default: () => <div data-testid="builtin-distribution" />,
}));

vi.mock('@/features/Connectors', () => ({
  ConnectorDetail: ({
    connectorId,
    lifecycleActions,
    managed,
  }: {
    connectorId: string;
    lifecycleActions?: ReactNode;
    managed?: boolean;
  }) => (
    <div data-managed={String(managed)} data-testid="connector-detail">
      <span>{connectorId}</span>
      {lifecycleActions}
    </div>
  ),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: (action: 'create_content' | 'edit_own_content') => ({
    allowed: mocks.permissions[action],
    reason: '',
  }),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: mocks.useToolStore,
}));

vi.mock('@/store/tool/selectors', () => ({
  builtinToolSelectors: {
    isBuiltinToolInstalled:
      (identifier: string) =>
      (state: typeof mocks.toolState): boolean =>
        state.installedBuiltinIds.includes(identifier),
    isSkillEnabled:
      (identifier: string, kind: 'builtin' | 'skill') =>
      (state: typeof mocks.toolState): boolean =>
        kind === 'builtin'
          ? state.installedBuiltinIds.includes(identifier)
          : !state.disabledSkillIdentifiers.includes(identifier),
  },
  composioStoreSelectors: {
    getServerByIdentifier:
      (identifier: string) =>
      (
        state: typeof mocks.toolState,
      ): (typeof mocks.toolState.composioServers)[number] | undefined =>
        state.composioServers.find((server) => server.identifier === identifier),
  },
  lobehubSkillStoreSelectors: {
    getServerByIdentifier:
      (identifier: string) =>
      (
        state: typeof mocks.toolState,
      ): (typeof mocks.toolState.lobehubSkillServers)[number] | undefined =>
        state.lobehubSkillServers.find((server) => server.identifier === identifier),
  },
}));

vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: {
    connectorByIdentifier:
      (identifier: string) =>
      (state: typeof mocks.toolState): (typeof mocks.toolState.connectors)[number] | undefined =>
        state.connectors.find((connector) => connector.identifier === identifier),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore<T>(selector: (state: typeof mocks.userState) => T): T {
    return selector(mocks.userState);
  },
}));

vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: {
    userId: (state: typeof mocks.userState) => state.userId,
  },
}));

const connectedNotionServer = () => ({
  identifier: 'notion',
  isConnected: true,
  name: 'Notion',
  status: LobehubSkillStatus.CONNECTED,
});

describe('SkillDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissions.create_content = true;
    mocks.permissions.edit_own_content = true;
    mocks.toolState.agentSkills = [];
    mocks.toolState.builtinSkills = [];
    mocks.toolState.composioServers = [];
    mocks.toolState.connectors = [];
    mocks.toolState.disabledSkillIdentifiers = [];
    mocks.toolState.installedBuiltinIds = [];
    mocks.toolState.lobehubSkillServers = [];
  });

  it('renders the enable switch instead of install/uninstall for a builtin skill', () => {
    mocks.toolState.builtinSkills = [
      {
        content: '# Artifacts',
        description: 'Build UI',
        identifier: 'lobe-artifacts',
        name: 'Artifacts',
      },
    ];

    render(<SkillDetail identifier="lobe-artifacts" type="builtin-skill" />);

    const toggle = screen.getByTestId('skill-enabled-switch');
    expect(toggle).toHaveAttribute('data-identifier', 'lobe-artifacts');
    expect(toggle).toHaveAttribute('data-kind', 'builtin');
    expect(screen.queryByRole('button', { name: 'store.actions.install' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'store.actions.uninstall' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the uninstall action and adds the enable switch for an agent skill', () => {
    mocks.toolState.agentSkills = [{ id: 'db-1', identifier: 'my-skill', name: 'My Skill' }];

    render(<SkillDetail identifier="db-1" type="agent-skill" />);

    // The row is addressed by id; the switch must bind to the skill identifier.
    const toggle = screen.getByTestId('skill-enabled-switch');
    expect(toggle).toHaveAttribute('data-identifier', 'my-skill');
    expect(toggle).toHaveAttribute('data-kind', 'skill');
    expect(screen.getByRole('button', { name: 'store.actions.uninstall' })).toBeInTheDocument();
  });

  describe('under the admin scope', () => {
    const renderWithAdminScope = (
      ui: ReactNode,
      overrides: Partial<AdminToolScope> = {},
    ): AdminToolScope => {
      const scope = {
        canSetSkillAvailability: vi.fn(() => true),
        connectors: [],
        deleteOrgSkill: vi.fn(),
        isBuiltinSkillEnabled: vi.fn(() => true),
        isOrgSkillEnabled: vi.fn(() => false),
        orgSkills: [{ id: 'db-1', identifier: 'org.skill', name: 'Org Skill' }],
        setOrgSkillEnabled: vi.fn().mockResolvedValue(undefined),
        toggleBuiltinSkill: vi.fn().mockResolvedValue(undefined),
        useOrgSkillDetail: vi.fn(() => ({ isLoading: false })),
        ...overrides,
      } as unknown as AdminToolScope;

      render(<AdminToolScopeProvider value={scope}>{ui}</AdminToolScopeProvider>);

      return scope;
    };

    it('toggles org-wide availability for an uploaded skill', async () => {
      const scope = renderWithAdminScope(<SkillDetail identifier="db-1" type="agent-skill" />);

      // The row is addressed by id; the catalog write is keyed by skill key.
      const toggle = screen.getByTestId('skill-enabled-switch');
      expect(toggle).toHaveAttribute('data-identifier', 'org.skill');
      expect(toggle).toHaveAttribute('data-checked', 'false');
      expect(toggle).toHaveAttribute('data-label', 'Org Skill');

      await userEvent.click(toggle);

      expect(scope.setOrgSkillEnabled).toHaveBeenCalledWith('org.skill', false);
    });

    it('locks the uploaded-skill switch without catalog permission', () => {
      renderWithAdminScope(<SkillDetail identifier="db-1" type="agent-skill" />, {
        canSetSkillAvailability: vi.fn(() => false),
      });

      expect(screen.getByTestId('skill-enabled-switch')).toHaveAttribute('data-disabled', 'true');
    });

    it('gates the builtin switch on catalog permission, not personal content rights', () => {
      mocks.toolState.builtinSkills = [
        { content: '# Artifacts', identifier: 'lobe-artifacts', name: 'Artifacts' },
      ];

      renderWithAdminScope(<SkillDetail identifier="lobe-artifacts" type="builtin-skill" />, {
        canSetSkillAvailability: vi.fn(() => false),
      });

      const toggle = screen.getByTestId('skill-enabled-switch');
      expect(toggle).toHaveAttribute('data-disabled', 'true');
      expect(toggle).toHaveAttribute('data-label', 'Artifacts');
    });
  });

  it('shows a disconnect action for a connected LobeHub connector without configurable tools', async () => {
    mocks.toolState.lobehubSkillServers = [connectedNotionServer()];

    render(<SkillDetail identifier="notion" type="lobehub-connector" />);

    expect(
      await screen.findByText('This skill does not expose configurable tool permissions.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Notion')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    expect(mocks.toolState.syncToolsFromClient).not.toHaveBeenCalled();
  });

  it('syncs LobeHub tools and passes the disconnect action into connector permissions detail', async () => {
    mocks.toolState.connectors = [{ id: 'connector-1', identifier: 'notion' }];
    mocks.toolState.lobehubSkillServers = [
      {
        ...connectedNotionServer(),
        tools: [
          {
            description: 'Search pages',
            inputSchema: { type: 'object' },
            name: 'search',
          },
        ],
      },
    ];

    render(<SkillDetail identifier="notion" type="lobehub-connector" />);

    expect(await screen.findByTestId('connector-detail')).toHaveTextContent('connector-1');
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.toolState.syncToolsFromClient).toHaveBeenCalledWith({
        identifier: 'notion',
        name: 'Notion',
        sourceType: 'marketplace',
        tools: [
          {
            description: 'Search pages',
            inputSchema: { type: 'object' },
            toolName: 'search',
          },
        ],
      }),
    );
  });

  it('does not expose legacy connector details or actions in managed mode', () => {
    mocks.toolState.connectors = [{ id: 'connector-1', identifier: 'notion' }];
    mocks.toolState.lobehubSkillServers = [
      {
        ...connectedNotionServer(),
        tools: [{ inputSchema: { type: 'object' }, name: 'search' }],
      },
    ];

    const { container } = render(
      <SkillDetail managed identifier="notion" type="lobehub-connector" />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it('only leaves connector permissions detail after disconnect actually succeeds', async () => {
    const user = userEvent.setup();
    mocks.toolState.connectors = [{ id: 'connector-1', identifier: 'notion' }];
    mocks.toolState.lobehubSkillServers = [
      {
        ...connectedNotionServer(),
        tools: [
          {
            inputSchema: { type: 'object' },
            name: 'search',
          },
        ],
      },
    ];
    mocks.confirmModal.mockImplementation(({ onOk }: { onOk?: () => Promise<void> }) => {
      void onOk?.();
    });
    mocks.toolState.revokeLobehubSkill.mockResolvedValue(undefined);

    render(<SkillDetail identifier="notion" type="lobehub-connector" />);

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));

    expect(mocks.confirmModal).toHaveBeenCalled();
    expect(await screen.findByTestId('connector-detail')).toBeInTheDocument();
    expect(
      screen.queryByText('This skill does not expose configurable tool permissions.'),
    ).not.toBeInTheDocument();
  });

  it('returns to the no-permissions state after a successful disconnect', async () => {
    const user = userEvent.setup();
    const server = {
      ...connectedNotionServer(),
      tools: [
        {
          inputSchema: { type: 'object' },
          name: 'search',
        },
      ],
    };
    mocks.toolState.connectors = [{ id: 'connector-1', identifier: 'notion' }];
    mocks.toolState.lobehubSkillServers = [server];
    mocks.confirmModal.mockImplementation(({ onOk }: { onOk?: () => Promise<void> }) => {
      void onOk?.();
    });
    mocks.toolState.revokeLobehubSkill.mockImplementation(async () => {
      server.isConnected = false;
      server.status = LobehubSkillStatus.NOT_CONNECTED;
    });

    render(<SkillDetail identifier="notion" type="lobehub-connector" />);

    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));

    await waitFor(() =>
      expect(
        screen.getByText('This skill does not expose configurable tool permissions.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });
});
