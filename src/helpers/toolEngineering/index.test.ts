import { type ToolManifest } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as UserMemorySelectorsModule from '@/store/userMemory/selectors';

import { createAgentToolsEngine, createToolsEngine, getEnabledTools } from './index';

// Mock the store and helper dependencies
vi.mock('@/store/tool', () => ({
  getToolStoreState: () => ({
    connectors: [],
    builtinTools: [
      {
        identifier: 'search',
        manifest: {
          api: [
            {
              description: 'Search the web',
              name: 'search',
              parameters: {
                properties: {
                  query: { description: 'Search query', type: 'string' },
                },
                required: ['query'],
                type: 'object',
              },
            },
          ],
          identifier: 'search',
          meta: {
            title: 'Web Search',
            description: 'Search tool',
            avatar: '🔍',
          },
          type: 'builtin',
        } as unknown as ToolManifest,
        type: 'builtin' as const,
      },
      {
        identifier: 'lobe-web-browsing',
        manifest: {
          api: [
            {
              description:
                'a search service. Useful for when you need to answer questions about current events. Input should be a search query. Output is a JSON array of the query results',
              name: 'search',
              parameters: {
                properties: {
                  query: { description: 'The search query', type: 'string' },
                },
                required: ['query'],
                type: 'object',
              },
            },
          ],
          identifier: 'lobe-web-browsing',
          meta: {
            title: 'Web Browsing',
            avatar: '🌐',
          },
          type: 'builtin',
        } as unknown as ToolManifest,
        type: 'builtin' as const,
      },
      {
        identifier: 'lobe-agent',
        manifest: {
          api: [
            {
              description: 'Analyze visual media',
              name: 'analyzeVisualMedia',
              parameters: {
                properties: {
                  question: { type: 'string' },
                  refs: {
                    items: { type: 'string' },
                    type: 'array',
                  },
                  urls: {
                    items: { type: 'string' },
                    type: 'array',
                  },
                },
                required: ['question'],
                type: 'object',
              },
            },
          ],
          identifier: 'lobe-agent',
          meta: {
            title: 'Lobe Agent',
            avatar: 'V',
          },
          type: 'builtin',
        } as unknown as ToolManifest,
        type: 'builtin' as const,
      },
      {
        identifier: 'lobe-reminder',
        manifest: {
          api: [
            {
              description: 'Create a timed reminder',
              name: 'createReminder',
              parameters: {
                properties: {
                  content: { type: 'string' },
                },
                required: ['content'],
                type: 'object',
              },
            },
          ],
          identifier: 'lobe-reminder',
          meta: {
            title: 'Reminders',
            avatar: '⏰',
          },
          type: 'builtin',
        } as unknown as ToolManifest,
        type: 'builtin' as const,
      },
      {
        identifier: 'lobe-dingtalk-approval',
        manifest: {
          api: [
            {
              description: 'List pending approvals',
              name: 'listPendingApprovals',
              parameters: { properties: {}, type: 'object' },
            },
          ],
          identifier: 'lobe-dingtalk-approval',
          meta: { title: 'DingTalk Approval', avatar: '✅' },
          type: 'builtin',
        } as unknown as ToolManifest,
        type: 'builtin' as const,
      },
      {
        identifier: 'lobe-dingtalk-workspace',
        manifest: {
          api: [
            {
              description: 'List todos',
              name: 'listTodos',
              parameters: { properties: {}, type: 'object' },
            },
          ],
          identifier: 'lobe-dingtalk-workspace',
          meta: { title: 'DingTalk Workspace', avatar: '📅' },
          type: 'builtin',
        } as unknown as ToolManifest,
        type: 'builtin' as const,
      },
      {
        identifier: 'lobe-dingtalk-personal',
        manifest: {
          api: [
            {
              description: 'List my DingTalk todos',
              name: 'listMyTodos',
              parameters: { properties: {}, type: 'object' },
            },
          ],
          identifier: 'lobe-dingtalk-personal',
          meta: { title: 'DingTalk Personal Data', avatar: '🔑' },
          type: 'builtin',
        } as unknown as ToolManifest,
        type: 'builtin' as const,
      },
      {
        identifier: 'lobe-dingtalk-docs',
        manifest: {
          api: [
            {
              description: 'Search my DingTalk docs',
              name: 'searchDocs',
              parameters: { properties: {}, type: 'object' },
            },
          ],
          identifier: 'lobe-dingtalk-docs',
          meta: { title: 'DingTalk Docs & Sheets', avatar: '📄' },
          type: 'builtin',
        } as unknown as ToolManifest,
        type: 'builtin' as const,
      },
      {
        identifier: 'lobe-enterprise-lookup',
        manifest: {
          api: [
            {
              description: 'Query enterprise records',
              name: 'queryEnterprise',
              parameters: { properties: {}, type: 'object' },
            },
          ],
          identifier: 'lobe-enterprise-lookup',
          meta: { title: 'Enterprise Lookup', avatar: '🏢' },
          type: 'builtin',
        } as unknown as ToolManifest,
        type: 'builtin' as const,
      },
      {
        identifier: 'lobe-user-memory',
        manifest: {
          api: [
            {
              description: 'Search user memories',
              name: 'searchUserMemory',
              parameters: { properties: {}, type: 'object' },
            },
          ],
          identifier: 'lobe-user-memory',
          meta: { title: 'Memory', avatar: '🧠' },
          type: 'builtin',
        } as unknown as ToolManifest,
        type: 'builtin' as const,
      },
    ],
  }),
}));

let mockGetInstalledPluginById: (id: string) => () => any = () => () => undefined;
let mockInstalledPluginManifestList: () => ToolManifest[] = () => [];

vi.mock('@/store/tool/selectors', () => ({
  pluginSelectors: {
    getInstalledPluginById: (id: string) => mockGetInstalledPluginById(id),
    installedPluginManifestList: () => mockInstalledPluginManifestList(),
  },
  composioStoreSelectors: {
    composioAsLobeTools: () => [],
  },
  lobehubSkillStoreSelectors: {
    lobehubSkillAsLobeTools: () => [],
  },
}));

let mockIsCanUseFC = true;

vi.mock('../isCanUseFC', () => ({
  isCanUseFC: () => mockIsCanUseFC,
}));

let mockCurrentAgentPlugins: string[] = [];
let mockCurrentAgentDisabledPlugins: string[] = [];
let mockEnableAgentMode: boolean | undefined;

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentDisabledPlugins: () => mockCurrentAgentDisabledPlugins,
    currentAgentPlugins: () => mockCurrentAgentPlugins,
    hasEnabledKnowledgeBases: () => false,
  },
  agentChatConfigSelectors: {
    currentChatConfig: () => ({ enableAgentMode: mockEnableAgentMode }),
    isCloudSandboxEnabled: () => false,
    isLocalSystemEnabled: () => false,
    isMemoryToolEnabled: () => false,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: { getState: () => ({}) },
}));

let mockDingtalkCaps: {
  dingtalkApproval?: boolean;
  dingtalkCalendar?: boolean;
  dingtalkDocs?: boolean;
  dingtalkPersonal?: boolean;
  dingtalkTodo?: boolean;
  enterpriseLookup?: boolean;
} = {};

vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({
    serverConfig: { enterprise: { capabilities: mockDingtalkCaps }, telemetry: {} },
  }),
}));

let mockGlobalMemoryEnabled = false;

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: {
    memoryEnabled: () => mockGlobalMemoryEnabled,
  },
}));

const CURRENT_SCOPE = 'user-1:personal';
let mockCacheScope = CURRENT_SCOPE;

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => mockCacheScope,
}));

let mockEmbeddingAvailabilityMap: Record<string, { available: boolean }> = {};

// Real selectors against a scope-keyed map, so the test covers the lookup by
// the current cache scope.
vi.mock('@/store/userMemory', async () => {
  const { userMemorySelectors } = await vi.importActual<typeof UserMemorySelectorsModule>(
    '@/store/userMemory/selectors',
  );

  return {
    getUserMemoryStoreState: () => ({
      memoryEmbeddingAvailabilityMap: mockEmbeddingAvailabilityMap,
    }),
    userMemorySelectors,
  };
});

/** Set the availability for the current scope (`undefined` = not loaded). */
const setCurrentScopeAvailability = (available: boolean | undefined) => {
  mockEmbeddingAvailabilityMap = available === undefined ? {} : { [CURRENT_SCOPE]: { available } };
};

let mockUseApplicationBuiltinSearchTool = true;

vi.mock('@/helpers/getSearchConfig', () => ({
  getSearchConfig: () => ({
    get useApplicationBuiltinSearchTool() {
      return mockUseApplicationBuiltinSearchTool;
    },
  }),
}));

describe('toolEngineering', () => {
  afterEach(() => {
    mockGetInstalledPluginById = () => () => undefined;
    mockInstalledPluginManifestList = () => [];
    mockUseApplicationBuiltinSearchTool = true;
    mockCurrentAgentPlugins = [];
    mockCurrentAgentDisabledPlugins = [];
    mockEnableAgentMode = undefined;
    mockIsCanUseFC = true;
    mockDingtalkCaps = {};
    mockGlobalMemoryEnabled = false;
    mockCacheScope = CURRENT_SCOPE;
    mockEmbeddingAvailabilityMap = {};
  });

  describe('createToolsEngine', () => {
    it('should generate tools array for enabled plugins', () => {
      const toolsEngine = createToolsEngine();
      const result = toolsEngine.generateTools({
        toolIds: ['search'],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      expect(result![0]).toMatchObject({
        function: {
          description: 'Search the web',
          name: 'search____search',
          parameters: {
            properties: {
              query: { description: 'Search query', type: 'string' },
            },
            required: ['query'],
            type: 'object',
          },
        },
        type: 'function',
      });
    });

    it('should return undefined when no plugins match', () => {
      const toolsEngine = createToolsEngine();
      const result = toolsEngine.generateTools({
        toolIds: ['non-existent'],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toBeUndefined();
    });

    it('should return detailed result with correct field names', () => {
      const toolsEngine = createToolsEngine();
      const result = toolsEngine.generateToolsDetailed({
        toolIds: ['search'],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result).toHaveProperty('enabledToolIds');
      expect(result).toHaveProperty('filteredTools');
      expect(result).toHaveProperty('tools');
      expect(result.enabledToolIds).toEqual(['search']);
      expect(result.filteredTools).toEqual([]);
      expect(result.tools).toHaveLength(1);
    });
  });

  describe('createChatToolsEngine', () => {
    it('should include web browsing tool as default when no tools are provided', () => {
      const toolsEngine = createAgentToolsEngine({
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = toolsEngine.generateToolsDetailed({
        toolIds: [], // No explicitly enabled tools
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain('lobe-web-browsing');
    });

    it('should include web browsing tool alongside user-provided tools', () => {
      mockCurrentAgentPlugins = ['search'];

      const toolsEngine = createAgentToolsEngine({
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = toolsEngine.generateToolsDetailed({
        toolIds: ['search'], // User explicitly enables search tool
        model: 'gpt-4',
        provider: 'openai',
      });

      // lobe-agent and lobe-reminder are always-on (alwaysOnToolIds).
      expect(result.enabledToolIds).toEqual([
        'search',
        'lobe-web-browsing',
        'lobe-reminder',
        'lobe-agent',
      ]);
      expect(result.enabledToolIds).toHaveLength(4);
    });

    it('should enable lobe-agent when it is injected into runtime plugin ids', () => {
      const toolsEngine = createAgentToolsEngine({ model: 'deepseek-chat', provider: 'deepseek' }, [
        'lobe-agent',
      ]);

      const result = toolsEngine.generateToolsDetailed({
        model: 'deepseek-chat',
        provider: 'deepseek',
        toolIds: [],
      });

      expect(result.enabledToolIds).toContain('lobe-agent');
    });

    it('should enable lobe-agent by default since it is always-on', () => {
      const toolsEngine = createAgentToolsEngine({
        model: 'deepseek-chat',
        provider: 'deepseek',
      });

      const result = toolsEngine.generateToolsDetailed({
        model: 'deepseek-chat',
        provider: 'deepseek',
        toolIds: [],
      });

      expect(result.enabledToolIds).toContain('lobe-agent');
    });

    it('enables lobe-reminder in agent mode because it is always-on', () => {
      const toolsEngine = createAgentToolsEngine({
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = toolsEngine.generateToolsDetailed({
        model: 'gpt-4',
        provider: 'openai',
        toolIds: [],
      });

      expect(result.enabledToolIds).toContain('lobe-reminder');
    });

    it('does not enable lobe-reminder in chat mode', () => {
      mockEnableAgentMode = false;

      const toolsEngine = createAgentToolsEngine({
        model: 'gpt-4',
        provider: 'openai',
      });

      const result = toolsEngine.generateToolsDetailed({
        model: 'gpt-4',
        provider: 'openai',
        toolIds: [],
      });

      expect(result.enabledToolIds).not.toContain('lobe-reminder');
    });

    it('should use chat-mode defaults when the model does not support function calling', () => {
      mockIsCanUseFC = false;

      const toolsEngine = createAgentToolsEngine({
        model: 'gemini-3.1-flash-lite-image',
        provider: 'lobehub',
      });

      const result = toolsEngine.generateToolsDetailed({
        model: 'gemini-3.1-flash-lite-image',
        provider: 'lobehub',
        toolIds: [],
      });

      expect(result.enabledToolIds).toEqual([]);
      expect(result.filteredTools).not.toContainEqual({
        id: 'lobe-agent',
        reason: 'incompatible',
      });
      expect(result.filteredTools).toContainEqual({
        id: 'lobe-web-browsing',
        reason: 'incompatible',
      });
    });
  });

  describe('isExplicitActivation bypass', () => {
    it.each([
      ['grok-4.6', 'grok'],
      ['gpt-4', 'openai'],
    ])(
      'should not inject web browsing for %s/%s when native search is the default',
      (model, provider) => {
        mockUseApplicationBuiltinSearchTool = false;

        const toolsEngine = createAgentToolsEngine({ model, provider });
        const result = toolsEngine.generateToolsDetailed({
          toolIds: [],
          model,
          provider,
        });

        expect(result.enabledToolIds).not.toContain('lobe-web-browsing');
      },
    );

    it('should disable web browsing when useApplicationBuiltinSearchTool is false', () => {
      mockUseApplicationBuiltinSearchTool = false;

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        toolIds: ['lobe-web-browsing'],
        model: 'gpt-4',
        provider: 'openai',
        skipDefaultTools: true,
      });

      expect(result.enabledToolIds).not.toContain('lobe-web-browsing');
      expect(result.filteredTools).toContainEqual({
        id: 'lobe-web-browsing',
        reason: 'not_found',
      });
    });

    it('does not let isExplicitActivation restore web browsing when native search is selected', () => {
      mockUseApplicationBuiltinSearchTool = false;

      const toolsEngine = createAgentToolsEngine({ model: 'grok-4.6', provider: 'grok' });
      const result = toolsEngine.generateToolsDetailed({
        context: { isExplicitActivation: true },
        toolIds: ['lobe-web-browsing'],
        model: 'grok-4.6',
        provider: 'grok',
        skipDefaultTools: true,
      });

      expect(result.enabledToolIds).not.toContain('lobe-web-browsing');
    });

    it('should bypass all enableChecker filters with isExplicitActivation', () => {
      mockUseApplicationBuiltinSearchTool = false;
      mockInstalledPluginManifestList = () => [
        {
          api: [
            {
              description: 'Run stdio tool',
              name: 'run',
              parameters: { properties: {}, required: [], type: 'object' },
            },
          ],
          identifier: 'stdio-mcp-plugin',
          meta: { title: 'Stdio MCP', avatar: '🔧' },
          type: 'default',
        } as unknown as ToolManifest,
      ];
      mockGetInstalledPluginById = (id: string) => () =>
        id === 'stdio-mcp-plugin'
          ? { customParams: { mcp: { type: 'stdio' } }, identifier: id }
          : undefined;
      mockCurrentAgentPlugins = ['stdio-mcp-plugin'];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        context: { isExplicitActivation: true },
        toolIds: ['stdio-mcp-plugin', 'lobe-web-browsing'],
        model: 'gpt-4',
        provider: 'openai',
        skipDefaultTools: true,
      });

      // Stdio MCP still bypasses platform filters; web browsing is physically
      // dropped when native search is selected, so the activator cannot stack it.
      expect(result.enabledToolIds).toContain('stdio-mcp-plugin');
      expect(result.enabledToolIds).not.toContain('lobe-web-browsing');
    });

    it('does NOT let isExplicitActivation enable a plugin the agent has disabled', () => {
      mockInstalledPluginManifestList = () => [
        {
          api: [{ description: 'x', name: 'x', parameters: {} }],
          identifier: 'disabled-plugin',
          meta: { title: 'Disabled Plugin' },
          type: 'default',
        } as unknown as ToolManifest,
      ];
      mockCurrentAgentDisabledPlugins = ['disabled-plugin'];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        context: { isExplicitActivation: true },
        toolIds: ['disabled-plugin'],
        model: 'gpt-4',
        provider: 'openai',
        skipDefaultTools: true,
      });

      // Unlike a merely rule-disabled tool, a disabled plugin's manifest is
      // absent from the pool entirely, so explicit activation has nothing to
      // resolve — it can't bypass a gate that was never reached.
      expect(result.enabledToolIds).not.toContain('disabled-plugin');
      expect(result.enabledToolIds).toEqual([]);
    });
  });

  describe('stdio MCP filtering on web', () => {
    const stdioMcpManifest = {
      api: [
        {
          description: 'Run stdio tool',
          name: 'run',
          parameters: { properties: {}, required: [], type: 'object' },
        },
      ],
      identifier: 'stdio-mcp-plugin',
      meta: { title: 'Stdio MCP', avatar: '🔧' },
      type: 'default',
    } as unknown as ToolManifest;

    const httpMcpManifest = {
      api: [
        {
          description: 'Run http tool',
          name: 'run',
          parameters: { properties: {}, required: [], type: 'object' },
        },
      ],
      identifier: 'http-mcp-plugin',
      meta: { title: 'HTTP MCP', avatar: '🌐' },
      type: 'default',
    } as unknown as ToolManifest;

    it('should filter stdio MCP tools in non-desktop environment', () => {
      mockInstalledPluginManifestList = () => [stdioMcpManifest];
      mockGetInstalledPluginById = (id: string) => () =>
        id === 'stdio-mcp-plugin'
          ? { customParams: { mcp: { type: 'stdio' } }, identifier: id }
          : undefined;
      mockCurrentAgentPlugins = ['stdio-mcp-plugin'];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        toolIds: ['stdio-mcp-plugin'],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain('stdio-mcp-plugin');
    });

    it('should NOT filter http MCP tools in non-desktop environment', () => {
      mockInstalledPluginManifestList = () => [httpMcpManifest];
      mockGetInstalledPluginById = (id: string) => () =>
        id === 'http-mcp-plugin'
          ? { customParams: { mcp: { type: 'http' } }, identifier: id }
          : undefined;
      mockCurrentAgentPlugins = ['http-mcp-plugin'];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        toolIds: ['http-mcp-plugin'],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain('http-mcp-plugin');
    });
  });

  describe('DingTalk workspace capability gates', () => {
    it('drops approval and workspace tools when capability flags are off', () => {
      mockDingtalkCaps = { dingtalkApproval: false, dingtalkCalendar: false, dingtalkTodo: false };
      mockCurrentAgentPlugins = ['lobe-dingtalk-approval', 'lobe-dingtalk-workspace'];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        toolIds: ['lobe-dingtalk-approval', 'lobe-dingtalk-workspace'],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain('lobe-dingtalk-approval');
      expect(result.enabledToolIds).not.toContain('lobe-dingtalk-workspace');
    });

    it('keeps the workspace tool when either todo or calendar is on', () => {
      mockDingtalkCaps = { dingtalkApproval: true, dingtalkCalendar: false, dingtalkTodo: true };
      mockCurrentAgentPlugins = ['lobe-dingtalk-approval', 'lobe-dingtalk-workspace'];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        toolIds: ['lobe-dingtalk-approval', 'lobe-dingtalk-workspace'],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain('lobe-dingtalk-approval');
      expect(result.enabledToolIds).toContain('lobe-dingtalk-workspace');
    });

    it('exposes DingTalk tools in agent mode without plugin selection when flags are on', () => {
      mockDingtalkCaps = { dingtalkApproval: true, dingtalkCalendar: true, dingtalkTodo: false };
      mockCurrentAgentPlugins = [];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        toolIds: [],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain('lobe-dingtalk-approval');
      expect(result.enabledToolIds).toContain('lobe-dingtalk-workspace');
    });

    it('fails closed when DingTalk capability flags are unknown', () => {
      mockDingtalkCaps = {};
      mockCurrentAgentPlugins = [];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        context: { isExplicitActivation: true },
        toolIds: [],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain('lobe-dingtalk-approval');
      expect(result.enabledToolIds).not.toContain('lobe-dingtalk-workspace');
    });

    it('does not expose DingTalk tools in chat mode even when flags are on', () => {
      mockEnableAgentMode = false;
      mockDingtalkCaps = { dingtalkApproval: true, dingtalkCalendar: true, dingtalkTodo: true };
      mockCurrentAgentPlugins = [];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        toolIds: [],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain('lobe-dingtalk-approval');
      expect(result.enabledToolIds).not.toContain('lobe-dingtalk-workspace');
    });

    it('gates approval and workspace independently', () => {
      mockDingtalkCaps = { dingtalkApproval: true, dingtalkCalendar: false, dingtalkTodo: false };
      mockCurrentAgentPlugins = [];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        toolIds: [],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain('lobe-dingtalk-approval');
      expect(result.enabledToolIds).not.toContain('lobe-dingtalk-workspace');
    });
  });

  describe('DingTalk personal data capability gate', () => {
    const generate = (toolIds: string[] = [], explicit = false) =>
      createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' }).generateToolsDetailed({
        context: explicit ? { isExplicitActivation: true } : undefined,
        model: 'gpt-4',
        provider: 'openai',
        toolIds,
      });

    it('drops lobe-dingtalk-personal when the capability flag is off, even if selected', () => {
      mockDingtalkCaps = { dingtalkPersonal: false };
      mockCurrentAgentPlugins = ['lobe-dingtalk-personal'];

      expect(generate(['lobe-dingtalk-personal']).enabledToolIds).not.toContain(
        'lobe-dingtalk-personal',
      );
    });

    it('fails closed when the capability flag is unknown', () => {
      mockDingtalkCaps = {};

      expect(generate([], true).enabledToolIds).not.toContain('lobe-dingtalk-personal');
    });

    it('exposes lobe-dingtalk-personal in agent mode without plugin selection when on', () => {
      mockDingtalkCaps = { dingtalkPersonal: true };
      mockCurrentAgentPlugins = [];

      expect(generate().enabledToolIds).toContain('lobe-dingtalk-personal');
    });

    it('does not expose lobe-dingtalk-personal in chat mode even when on', () => {
      mockEnableAgentMode = false;
      mockDingtalkCaps = { dingtalkPersonal: true };

      expect(generate().enabledToolIds).not.toContain('lobe-dingtalk-personal');
    });

    it('gates personal data independently of the workspace tool', () => {
      mockDingtalkCaps = { dingtalkPersonal: false, dingtalkTodo: true };
      const workspaceOnly = generate().enabledToolIds;
      expect(workspaceOnly).toContain('lobe-dingtalk-workspace');
      expect(workspaceOnly).not.toContain('lobe-dingtalk-personal');

      mockDingtalkCaps = { dingtalkPersonal: true, dingtalkTodo: false };
      const personalOnly = generate().enabledToolIds;
      expect(personalOnly).toContain('lobe-dingtalk-personal');
      expect(personalOnly).not.toContain('lobe-dingtalk-workspace');
    });
  });

  describe('DingTalk docs & sheets capability gate', () => {
    const DOCS = 'lobe-dingtalk-docs';
    const generate = (toolIds: string[] = [], explicit = false) =>
      createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' }).generateToolsDetailed({
        context: explicit ? { isExplicitActivation: true } : undefined,
        model: 'gpt-4',
        provider: 'openai',
        toolIds,
      });

    it('drops lobe-dingtalk-docs when the capability flag is off, even if selected', () => {
      mockDingtalkCaps = { dingtalkDocs: false, dingtalkPersonal: true };
      mockCurrentAgentPlugins = [DOCS];

      expect(generate([DOCS]).enabledToolIds).not.toContain(DOCS);
    });

    it('keeps the activator from loading lobe-dingtalk-docs while the flag is off', () => {
      mockDingtalkCaps = { dingtalkDocs: false, dingtalkPersonal: true };

      expect(generate([DOCS], true).enabledToolIds).not.toContain(DOCS);
    });

    it('fails closed when the capability flag is unknown', () => {
      mockDingtalkCaps = { dingtalkPersonal: true };

      expect(generate([DOCS], true).enabledToolIds).not.toContain(DOCS);
    });

    it('stays off without personal data even if the docs flag is on', () => {
      mockDingtalkCaps = { dingtalkDocs: true, dingtalkPersonal: false };

      expect(generate([DOCS], true).enabledToolIds).not.toContain(DOCS);
    });

    it('exposes lobe-dingtalk-docs in agent mode without plugin selection when on', () => {
      mockDingtalkCaps = { dingtalkDocs: true, dingtalkPersonal: true };
      mockCurrentAgentPlugins = [];

      const enabled = generate().enabledToolIds;
      expect(enabled).toContain(DOCS);
      expect(enabled).toContain('lobe-dingtalk-personal');
    });

    it('does not expose lobe-dingtalk-docs in chat mode even when on', () => {
      mockEnableAgentMode = false;
      mockDingtalkCaps = { dingtalkDocs: true, dingtalkPersonal: true };

      expect(generate().enabledToolIds).not.toContain(DOCS);
    });

    it('leaves the personal tool on when only the docs flag is off', () => {
      mockDingtalkCaps = { dingtalkDocs: false, dingtalkPersonal: true };
      const enabled = generate().enabledToolIds;

      expect(enabled).toContain('lobe-dingtalk-personal');
      expect(enabled).not.toContain(DOCS);
    });
  });

  describe('enterprise lookup capability gate', () => {
    it('drops lobe-enterprise-lookup when the capability flag is off', () => {
      mockDingtalkCaps = { enterpriseLookup: false };
      mockCurrentAgentPlugins = ['lobe-enterprise-lookup'];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        toolIds: ['lobe-enterprise-lookup'],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).not.toContain('lobe-enterprise-lookup');
    });

    it('keeps lobe-enterprise-lookup when the capability flag is on', () => {
      mockDingtalkCaps = { enterpriseLookup: true };
      mockCurrentAgentPlugins = ['lobe-enterprise-lookup'];

      const toolsEngine = createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' });
      const result = toolsEngine.generateToolsDetailed({
        toolIds: ['lobe-enterprise-lookup'],
        model: 'gpt-4',
        provider: 'openai',
      });

      expect(result.enabledToolIds).toContain('lobe-enterprise-lookup');
    });
  });

  describe('memory embedding availability gate', () => {
    const generate = (options: { explicit?: boolean; toolIds?: string[] } = {}) =>
      createAgentToolsEngine({ model: 'gpt-4', provider: 'openai' }).generateToolsDetailed({
        context: options.explicit ? { isExplicitActivation: true } : undefined,
        model: 'gpt-4',
        provider: 'openai',
        toolIds: options.toolIds ?? [],
      });

    it('keeps the memory tool when the toggle is on and availability is not loaded yet', () => {
      mockGlobalMemoryEnabled = true;
      setCurrentScopeAvailability(undefined);

      expect(generate().enabledToolIds).toContain('lobe-user-memory');
    });

    it('keeps the memory tool when the toggle is on and embeddings are available', () => {
      mockGlobalMemoryEnabled = true;
      setCurrentScopeAvailability(true);

      expect(generate().enabledToolIds).toContain('lobe-user-memory');
    });

    it('drops the memory tool from the pool when no embedding model is configured', () => {
      mockGlobalMemoryEnabled = true;
      setCurrentScopeAvailability(false);

      const result = generate({ toolIds: ['lobe-user-memory'] });

      expect(result.enabledToolIds).not.toContain('lobe-user-memory');
      // Physically absent from the manifest pool, not merely rule-disabled.
      expect(result.filteredTools).toContainEqual({ id: 'lobe-user-memory', reason: 'not_found' });
    });

    it('does not let explicit activation restore the memory tool without embeddings', () => {
      mockGlobalMemoryEnabled = true;
      setCurrentScopeAvailability(false);

      const result = generate({ explicit: true, toolIds: ['lobe-user-memory'] });

      expect(result.enabledToolIds).not.toContain('lobe-user-memory');
    });

    it('still respects the memory toggle when embeddings are available', () => {
      mockGlobalMemoryEnabled = false;
      setCurrentScopeAvailability(true);

      const result = generate();

      expect(result.enabledToolIds).not.toContain('lobe-user-memory');
      expect(result.filteredTools).toContainEqual({ id: 'lobe-user-memory', reason: 'disabled' });
    });

    it('ignores an "unavailable" result from another account / workspace scope', () => {
      mockGlobalMemoryEnabled = true;
      // The previous scope confirmed no embedding model; the new scope has not
      // been checked yet, so it must read as unknown and keep the tool.
      mockEmbeddingAvailabilityMap = { 'user-1:workspace-a': { available: false } };
      mockCacheScope = 'user-1:workspace-b';

      expect(generate().enabledToolIds).toContain('lobe-user-memory');

      // Once the new scope's own check lands, it alone decides.
      mockEmbeddingAvailabilityMap = {
        'user-1:workspace-a': { available: true },
        'user-1:workspace-b': { available: false },
      };

      expect(generate().enabledToolIds).not.toContain('lobe-user-memory');
    });

    it('applies the same gate in chat mode', () => {
      mockEnableAgentMode = false;
      mockGlobalMemoryEnabled = true;

      setCurrentScopeAvailability(undefined);
      expect(generate().enabledToolIds).toContain('lobe-user-memory');

      setCurrentScopeAvailability(false);
      expect(generate().enabledToolIds).not.toContain('lobe-user-memory');
    });
  });

  describe('Migration functions', () => {
    describe('getEnabledTools', () => {
      it('should return empty array when no tool IDs provided', () => {
        const result = getEnabledTools([], 'gpt-4', 'openai');
        expect(result).toEqual([]);
      });

      it('should return tools for valid tool IDs', () => {
        const result = getEnabledTools(['search'], 'gpt-4', 'openai');
        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty('type', 'function');
        expect(result[0].function).toHaveProperty('name', 'search____search');
      });

      it('should use provided model and provider', () => {
        const result = getEnabledTools(['search'], 'gpt-3.5-turbo', 'anthropic');
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
      });

      it('should return empty array for non-existent tools', () => {
        const result = getEnabledTools(['non-existent-tool'], 'gpt-4', 'openai');
        expect(result).toEqual([]);
      });
    });
  });
});
