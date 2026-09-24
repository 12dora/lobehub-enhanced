import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/enterprise/services/moduleSettings', () => ({
  getModuleSettingsSnapshot: async () => {
    const disabled = new Set(
      (process.env.LOBE_MODULES_DISABLED ?? '').split(/[,\s]+/).filter(Boolean),
    );
    return {
      effective: {
        knowledgeBase: !disabled.has('knowledgeBase'),
        market: !disabled.has('market'),
        memory: !disabled.has('memory'),
      },
    };
  },
  isBootModuleEnabled: () => false,
  isModuleEnabled: async () => true,
}));

vi.mock('@/server/enterprise/services/aiCatalog/runtimeBridge', () => ({
  ensurePlatformAiRuntimeRegistered: () => undefined,
}));

vi.mock('@/server/enterprise/services/infraSettings/snapshot', () => ({
  getInfraSnapshot: async () => ({ objectStorage: { kind: 'unconfigured' } }),
}));

vi.mock('@/server/enterprise/featureFlags', () => ({
  isAnyEnterpriseFeatureEnabled: () => false,
  isPlatformAdminFeatureEnabled: () => false,
}));

interface CapturedProviderConfig {
  enabled?: boolean;
  enabledKey?: string;
  fetchOnClient?: boolean;
  modelListKey?: string;
  withDeploymentName?: boolean;
}

const mocks = vi.hoisted(() => ({
  genServerAiProvidersConfig: vi.fn(
    async (_specificConfig: Record<string, CapturedProviderConfig>) => ({}),
  ),
}));

interface MockGlobalConfigOptions {
  agentGatewayUrl?: string;
  enableAgentGateway?: boolean;
}

const mockGlobalConfigDependencies = (
  enableBusinessFeatures: boolean,
  options: MockGlobalConfigOptions = {},
) => {
  vi.doMock('@lobechat/business-const', () => ({
    ENABLE_BUSINESS_FEATURES: enableBusinessFeatures,
  }));

  vi.doMock('@/config/composio', () => ({
    composioEnv: {},
  }));

  vi.doMock('@/const/version', () => ({
    isDesktop: false,
  }));

  vi.doMock('@/envs/app', () => ({
    appEnv: {
      ...(options.agentGatewayUrl ? { AGENT_GATEWAY_URL: options.agentGatewayUrl } : {}),
      ...(options.enableAgentGateway === undefined
        ? {}
        : { ENABLE_AGENT_GATEWAY: options.enableAgentGateway }),
    },
    getAppConfig: vi.fn(() => ({
      DEFAULT_AGENT_CONFIG: '',
    })),
  }));

  vi.doMock('@/envs/auth', () => ({
    authEnv: {
      AUTH_DISABLE_EMAIL_PASSWORD: false,
      AUTH_EMAIL_VERIFICATION: false,
      AUTH_ENABLE_MAGIC_LINK: false,
      AUTH_SSO_PROVIDERS: '',
    },
  }));

  vi.doMock('@/envs/file', () => ({
    fileEnv: {},
  }));

  vi.doMock('@/envs/image', () => ({
    imageEnv: {
      AI_IMAGE_DEFAULT_IMAGE_NUM: undefined,
    },
  }));

  vi.doMock('@/envs/knowledge', () => ({
    knowledgeEnv: {
      DEFAULT_FILES_CONFIG: undefined,
    },
  }));

  vi.doMock('@/envs/langfuse', () => ({
    langfuseEnv: {
      ENABLE_LANGFUSE: false,
    },
  }));

  vi.doMock('@/envs/tools', () => ({
    toolsEnv: {},
  }));

  vi.doMock('@/server/services/sandbox', () => ({
    getSandboxProviderKind: () => process.env.SANDBOX_PROVIDER || 'local',
  }));

  vi.doMock('@/libs/better-auth/utils/server', () => ({
    parseSSOProviders: vi.fn(() => []),
  }));

  vi.doMock('@/server/globalConfig/parseSystemAgent', () => ({
    parseSystemAgent: vi.fn(() => undefined),
  }));

  vi.doMock('@/utils/object', () => ({
    cleanObject: vi.fn((object) => object),
  }));

  vi.doMock('./genServerAiProviderConfig', () => ({
    genServerAiProvidersConfig: mocks.genServerAiProvidersConfig,
  }));

  vi.doMock('./parseDefaultAgent', () => ({
    parseAgentConfig: vi.fn(() => ({})),
  }));

  vi.doMock('./parseFilesConfig', () => ({
    parseFilesConfig: vi.fn(() => ({})),
  }));

  vi.doMock('./parseMemoryExtractionConfig', () => ({
    getPublicMemoryExtractionConfig: vi.fn(() => ({})),
  }));

  vi.doMock('./aiProvidersCache', () => ({
    getCachedServerAiProvidersConfig: (specificConfig: Record<string, CapturedProviderConfig>) =>
      mocks.genServerAiProvidersConfig(specificConfig),
    resetAiProvidersCacheForTest: () => undefined,
  }));

  vi.doMock('@/server/enterprise/services/enterpriseLookup', () => ({
    isEnterpriseLookupConfigured: async () => false,
  }));

  vi.doMock('@/server/enterprise/services/dingtalkPersonal', () => ({
    getDingtalkPersonalConfig: async () => ({
      brokerConfigured: false,
      enabled: false,
      features: {
        chat: false,
        docs: false,
        report: false,
        sheets: false,
        todo: false,
        write: false,
      },
    }),
    invalidateDingtalkPersonalConfig: () => undefined,
  }));
};

const loadCapturedProviderConfig = async (enableBusinessFeatures: boolean) => {
  vi.resetModules();
  mocks.genServerAiProvidersConfig.mockClear();
  mockGlobalConfigDependencies(enableBusinessFeatures);

  const { getServerGlobalConfig } = await import('./index');
  await getServerGlobalConfig();

  return mocks.genServerAiProvidersConfig.mock.calls[0][0] as Record<
    string,
    CapturedProviderConfig
  >;
};

const loadServerConfig = async (
  enableBusinessFeatures: boolean,
  options?: MockGlobalConfigOptions,
) => {
  vi.resetModules();
  mocks.genServerAiProvidersConfig.mockClear();
  mockGlobalConfigDependencies(enableBusinessFeatures, options);

  const { getServerGlobalConfig } = await import('./index');
  return getServerGlobalConfig();
};

describe('getServerGlobalConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should only enable LobeHub by default in business feature mode', async () => {
    const providerConfig = await loadCapturedProviderConfig(true);

    expect(providerConfig[ModelProvider.LobeHub].enabled).toBe(true);
    expect(providerConfig[ModelProvider.DeepSeek].enabled).toBe(false);
    expect(providerConfig[ModelProvider.Ollama].fetchOnClient).toBe(true);

    for (const provider of Object.values(ModelProvider)) {
      if (provider === ModelProvider.LobeHub) continue;

      expect(providerConfig[provider].enabled).toBe(false);
    }
  });

  it('should keep upstream defaults outside business feature mode', async () => {
    const providerConfig = await loadCapturedProviderConfig(false);

    expect(providerConfig[ModelProvider.LobeHub]).toBeUndefined();
    expect(providerConfig[ModelProvider.OpenAI]).toBeUndefined();
    expect(providerConfig[ModelProvider.DeepSeek].enabled).toBe(true);
  });

  it('should enable gateway mode for business builds', async () => {
    await expect(loadServerConfig(true)).resolves.toMatchObject({
      enableGatewayMode: true,
    });
  });

  it('should enable gateway mode for self-hosted builds only when explicitly enabled with a gateway url', async () => {
    await expect(
      loadServerConfig(false, {
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: true,
      }),
    ).resolves.toMatchObject({
      agentGatewayUrl: 'https://gateway.test.com',
      enableGatewayMode: true,
    });

    await expect(
      loadServerConfig(false, {
        agentGatewayUrl: 'https://gateway.test.com',
        enableAgentGateway: false,
      }),
    ).resolves.toMatchObject({
      agentGatewayUrl: 'https://gateway.test.com',
      enableGatewayMode: false,
    });

    await expect(loadServerConfig(false, { enableAgentGateway: true })).resolves.toMatchObject({
      enableGatewayMode: false,
    });
  });

  it('exposes sandboxProvider from SANDBOX_PROVIDER (default local)', async () => {
    const previous = process.env.SANDBOX_PROVIDER;
    delete process.env.SANDBOX_PROVIDER;
    try {
      await expect(loadServerConfig(false)).resolves.toMatchObject({
        sandboxProvider: 'local',
      });

      process.env.SANDBOX_PROVIDER = 'market';
      await expect(loadServerConfig(false)).resolves.toMatchObject({
        sandboxProvider: 'market',
      });
    } finally {
      if (previous === undefined) {
        delete process.env.SANDBOX_PROVIDER;
      } else {
        process.env.SANDBOX_PROVIDER = previous;
      }
    }
  });

  it('defaults enterprise.capabilities.enterpriseLookup to false', async () => {
    const config = await loadServerConfig(false);
    expect(config.enterprise?.capabilities?.enterpriseLookup).toBe(false);
  });

  it('defaults enterprise.capabilities.dingtalkPersonal to false', async () => {
    const config = await loadServerConfig(false);
    expect(config.enterprise?.capabilities?.dingtalkPersonal).toBe(false);
    expect(config.enterprise?.capabilities?.dingtalkDocs).toBe(false);
  });

  it('exposes enterprise.capabilities.dingtalkPersonal when personal data is enabled', async () => {
    vi.resetModules();
    mocks.genServerAiProvidersConfig.mockClear();
    mockGlobalConfigDependencies(false);
    vi.doMock('@/server/enterprise/services/dingtalkPersonal', () => ({
      getDingtalkPersonalConfig: async () => ({
        brokerConfigured: true,
        enabled: true,
        features: {
          chat: true,
          docs: false,
          report: false,
          sheets: false,
          todo: true,
          write: false,
        },
      }),
      invalidateDingtalkPersonalConfig: () => undefined,
    }));
    const { getServerGlobalConfig } = await import('./index');
    const config = await getServerGlobalConfig();
    expect(config.enterprise?.capabilities?.dingtalkPersonal).toBe(true);
    expect(config.enterprise?.capabilities?.dingtalkDocs).toBe(false);
  });

  it('exposes dingtalkDocs only when personal data and a docs or sheets switch are on', async () => {
    const load = async (config: { docs?: boolean; enabled: boolean; sheets?: boolean }) => {
      vi.resetModules();
      mocks.genServerAiProvidersConfig.mockClear();
      mockGlobalConfigDependencies(false);
      vi.doMock('@/server/enterprise/services/dingtalkPersonal', () => ({
        getDingtalkPersonalConfig: async () => ({
          brokerConfigured: true,
          enabled: config.enabled,
          features: {
            chat: false,
            docs: config.docs === true,
            report: false,
            sheets: config.sheets === true,
            todo: false,
            write: false,
          },
        }),
      }));
      const { getServerGlobalConfig } = await import('./index');
      return getServerGlobalConfig();
    };

    const docsOn = await load({ docs: true, enabled: true });
    expect(docsOn.enterprise?.capabilities?.dingtalkDocs).toBe(true);
    expect(docsOn.enterprise?.capabilities?.dingtalkPersonal).toBe(true);

    const sheetsOn = await load({ enabled: true, sheets: true });
    expect(sheetsOn.enterprise?.capabilities?.dingtalkDocs).toBe(true);

    const personalOff = await load({ docs: true, enabled: false, sheets: true });
    expect(personalOff.enterprise?.capabilities?.dingtalkDocs).toBe(false);
    expect(personalOff.enterprise?.capabilities?.dingtalkPersonal).toBe(false);
  });

  it('fails closed when the personal-data config cannot be read', async () => {
    vi.resetModules();
    mocks.genServerAiProvidersConfig.mockClear();
    mockGlobalConfigDependencies(false);
    vi.doMock('@/server/enterprise/services/dingtalkPersonal', () => ({
      getDingtalkPersonalConfig: async () => {
        throw new Error('db down');
      },
    }));
    const { getServerGlobalConfig } = await import('./index');
    const config = await getServerGlobalConfig();
    expect(config.enterprise?.capabilities?.dingtalkPersonal).toBe(false);
    expect(config.enterprise?.capabilities?.dingtalkDocs).toBe(false);
  });

  it('exposes enterprise.capabilities.enterpriseLookup from runtime config', async () => {
    vi.resetModules();
    mocks.genServerAiProvidersConfig.mockClear();
    mockGlobalConfigDependencies(false);
    vi.doMock('@/server/enterprise/services/enterpriseLookup', () => ({
      isEnterpriseLookupConfigured: async () => true,
    }));
    const { getServerGlobalConfig } = await import('./index');
    const config = await getServerGlobalConfig();
    expect(config.enterprise?.capabilities?.enterpriseLookup).toBe(true);
  });

  it('exposes enterprise.modules from LOBE_MODULES_DISABLED', async () => {
    const previous = process.env.LOBE_MODULES_DISABLED;
    process.env.LOBE_MODULES_DISABLED = 'market,memory';
    try {
      const config = await loadServerConfig(false);
      expect(config.enterprise?.modules?.market).toBe(false);
      expect(config.enterprise?.modules?.memory).toBe(false);
      expect(config.enterprise?.modules?.knowledgeBase).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.LOBE_MODULES_DISABLED;
      } else {
        process.env.LOBE_MODULES_DISABLED = previous;
      }
    }
  });
});
