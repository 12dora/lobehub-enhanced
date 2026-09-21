import { type ToolManifest } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  dingtalkTodo?: boolean;
  enterpriseLookup?: boolean;
} = {};

vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => ({
    serverConfig: { enterprise: { capabilities: mockDingtalkCaps }, telemetry: {} },
  }),
}));

vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: {
    memoryEnabled: () => false,
  },
}));

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
