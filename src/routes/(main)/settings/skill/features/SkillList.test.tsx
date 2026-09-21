/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SkillList from './SkillList';

const mocks = vi.hoisted(() => {
  const toolState = {
    builtinSkills: [] as Array<{ identifier: string }>,
    builtinTools: [] as Array<{ hidden?: boolean; identifier: string; title: string }>,
    fetchConnectors: vi.fn(),
    isConnectorsInit: true,
    uninstalledBuiltinTools: [] as string[],
    useFetchAgentSkills: vi.fn(() => ({ error: undefined, mutate: vi.fn() })),
    useFetchInstalledPlugins: vi.fn(() => ({ error: undefined, mutate: vi.fn() })),
    useFetchLobehubSkillConnections: vi.fn(() => ({ error: undefined, mutate: vi.fn() })),
    useFetchUninstalledBuiltinTools: vi.fn(() => ({ error: undefined, mutate: vi.fn() })),
    useFetchUserComposioConnections: vi.fn(() => ({ error: undefined, mutate: vi.fn() })),
  };

  const serverConfigState = {
    enterpriseCapabilities: undefined as Record<string, boolean> | undefined,
  };

  const adminScopeRef = { current: null as null | Record<string, unknown> };

  return { adminScopeRef, serverConfigState, toolState };
});

vi.mock('@lobehub/ui', () => ({
  Center: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Empty: ({ title }: { title?: ReactNode }) => <div data-testid="empty">{title}</div>,
}));

vi.mock('@lobehub/ui/icons', () => ({ SkillsIcon: () => <span /> }));

vi.mock('antd-style', () => ({
  createStaticStyles: (
    creator: (tokens: {
      css: () => string;
      cssVar: Record<string, string>;
    }) => Record<string, string>,
  ) => creator({ css: () => '', cssVar: {} }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/components/AsyncError', () => ({ default: () => <div data-testid="async-error" /> }));

vi.mock('@/features/AdminToolScope', () => ({
  useAdminToolScope: () => mocks.adminScopeRef.current,
}));

vi.mock('./AgentSkillItem', () => ({ default: () => <div /> }));
vi.mock('./ComposioSkillItem', () => ({ default: () => <div /> }));
vi.mock('./LobehubSkillItem', () => ({ default: () => <div /> }));
vi.mock('./McpSkillItem', () => ({ default: () => <div /> }));
vi.mock('./BuiltinSkillItem', () => ({
  default: ({ identifier }: { identifier: string }) => (
    <div data-identifier={identifier} data-testid="builtin-tool" />
  ),
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableComposio: () => false,
    enableLobehubSkill: () => false,
    enterpriseCapabilities: (s: typeof mocks.serverConfigState) => s.enterpriseCapabilities,
  },
  useServerConfigStore: <T,>(selector: (state: typeof mocks.serverConfigState) => T): T =>
    selector(mocks.serverConfigState),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: <T,>(selector: (state: typeof mocks.toolState) => T): T =>
    selector(mocks.toolState),
}));

vi.mock('@/store/tool/selectors', () => ({
  agentSkillsSelectors: {
    getMarketAgentSkills: () => [],
    getUserAgentSkills: () => [],
  },
  builtinToolSelectors: {
    uninstalledBuiltinTools: (s: typeof mocks.toolState) => s.uninstalledBuiltinTools,
  },
  composioStoreSelectors: { getServers: () => [] },
  lobehubSkillStoreSelectors: { getServers: () => [] },
  pluginSelectors: { installedPluginMetaList: () => [] },
}));

vi.mock('@/store/tool/slices/composioStore', () => ({
  ComposioServerStatus: { ACTIVE: 'active' },
}));

vi.mock('@/store/tool/slices/lobehubSkillStore/types', () => ({
  LobehubSkillStatus: { CONNECTED: 'connected' },
}));

vi.mock('@/store/tool/slices/connector', () => ({
  connectorSelectors: { customConnectors: () => [] },
}));

const tool = (identifier: string, hidden = false) => ({ hidden, identifier, title: identifier });

const listedIdentifiers = () =>
  screen.queryAllByTestId('builtin-tool').map((node) => node.dataset.identifier);

const renderList = () => render(<SkillList onSelect={vi.fn()} viewMode="connector" />);

beforeEach(() => {
  mocks.adminScopeRef.current = null;
  mocks.serverConfigState.enterpriseCapabilities = undefined;
  mocks.toolState.builtinTools = [
    // `lobe-task` is the only RECOMMENDED_SKILLS entry in this fixture.
    tool('lobe-task'),
    tool('lobe-creds'),
    tool('lobe-calculator'),
    tool('lobe-delivery-checker'),
    tool('lobe-page-agent', true),
  ];
  // Everything outside RECOMMENDED_SKILLS defaults to uninstalled.
  mocks.toolState.uninstalledBuiltinTools = [
    'lobe-creds',
    'lobe-calculator',
    'lobe-delivery-checker',
  ];
});

describe('SkillList builtin tools', () => {
  it('lists builtin tools that default to uninstalled so they can be switched on', () => {
    renderList();

    expect(listedIdentifiers()).toEqual(
      expect.arrayContaining([
        'lobe-task',
        'lobe-creds',
        'lobe-calculator',
        'lobe-delivery-checker',
      ]),
    );
  });

  it('still hides internal builtin tools', () => {
    renderList();

    expect(listedIdentifiers()).not.toContain('lobe-page-agent');
  });

  it('keeps installed tools ahead of the uninstalled ones', () => {
    mocks.toolState.uninstalledBuiltinTools = ['lobe-creds', 'lobe-delivery-checker'];

    renderList();

    const ids = listedIdentifiers();
    expect(ids.indexOf('lobe-calculator')).toBeLessThan(ids.indexOf('lobe-creds'));
  });

  // The admin catalog reports org-wide availability, so its list must keep
  // showing only what the org enabled.
  it('leaves the admin scope list filtered by org availability', () => {
    const enabled = new Set(['lobe-task', 'lobe-calculator']);
    mocks.adminScopeRef.current = {
      connectors: [],
      isBuiltinSkillEnabled: (identifier: string) => enabled.has(identifier),
      listError: undefined,
      orgSkills: [],
      retry: vi.fn(),
    };

    renderList();

    expect(listedIdentifiers()).toEqual(['lobe-task', 'lobe-calculator']);
  });
});

describe('SkillList capability-gated builtin tools', () => {
  const gated = ['lobe-dingtalk-workspace', 'lobe-dingtalk-approval', 'lobe-enterprise-lookup'];

  beforeEach(() => {
    mocks.toolState.builtinTools = [tool('lobe-task'), ...gated.map((id) => tool(id))];
    mocks.toolState.uninstalledBuiltinTools = gated;
  });

  it('hides every gated tool while the capability payload is unknown', () => {
    renderList();

    expect(listedIdentifiers()).toEqual(['lobe-task']);
  });

  it('hides gated tools whose capability is off', () => {
    mocks.serverConfigState.enterpriseCapabilities = {
      dingtalkApproval: false,
      dingtalkCalendar: false,
      dingtalkTodo: false,
      enterpriseLookup: true,
    };

    renderList();

    expect(listedIdentifiers()).toEqual(expect.arrayContaining(['lobe-enterprise-lookup']));
    expect(listedIdentifiers()).not.toContain('lobe-dingtalk-approval');
    expect(listedIdentifiers()).not.toContain('lobe-dingtalk-workspace');
  });

  // They run on the capability flag regardless of the per-user list, so they
  // must not sink to the bottom with the genuinely uninstalled rows.
  it('sorts administrator-governed tools with the active ones', () => {
    mocks.serverConfigState.enterpriseCapabilities = { enterpriseLookup: true };
    mocks.toolState.builtinTools = [
      tool('lobe-task'),
      tool('lobe-creds'),
      tool('lobe-enterprise-lookup'),
    ];
    mocks.toolState.uninstalledBuiltinTools = ['lobe-creds', 'lobe-enterprise-lookup'];

    renderList();

    const ids = listedIdentifiers();
    expect(ids.indexOf('lobe-enterprise-lookup')).toBeLessThan(ids.indexOf('lobe-creds'));
  });

  it('lists gated tools once their capability is on', () => {
    mocks.serverConfigState.enterpriseCapabilities = {
      dingtalkApproval: true,
      dingtalkTodo: true,
      enterpriseLookup: true,
    };

    renderList();

    expect(listedIdentifiers()).toEqual(expect.arrayContaining(gated));
  });
});
