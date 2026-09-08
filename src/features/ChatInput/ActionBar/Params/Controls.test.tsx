/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import chatCopy from '@/locales/default/chat';

import Controls from './Controls';

const ADVANCED_OPEN_STORAGE_KEY = 'lobehub-chat-input-params-advanced-open';

const mocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  config: {
    chatConfig: { enableHistoryCount: true, historyCount: 8 },
    params: { temperature: 0.7 },
  } as Record<string, unknown>,
  enableAgentMode: false,
  isPlatformManaged: false,
  updateAgentConfig: vi.fn(),
}));

/**
 * Only the managed hint needs real copy; every other label is asserted by its key, which
 * keeps the test readable and independent of the `setting` wording.
 */
vi.mock('react-i18next', async () => {
  const chat = (await import('@/locales/default/chat')).default as Record<string, string>;

  return {
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        options?.ns === 'chat' ? (chat[key] ?? key) : key,
    }),
  };
});

vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => mocks.agentId }));

vi.mock('../../hooks/useUpdateAgentConfig', () => ({
  useUpdateAgentConfig: () => ({ updateAgentConfig: mocks.updateAgentConfig }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: undefined }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentConfigById: () => () => mocks.config,
    getAgentEnableModeById: () => () => mocks.enableAgentMode,
    getAgentModelById: () => () => 'gpt-5.5',
    getAgentModelProviderById: () => () => 'openai',
    isAgentPlatformManagedById: () => () => mocks.isPlatformManaged,
  },
  chatConfigByIdSelectors: {
    getChatConfigById: () => () => mocks.config.chatConfig as Record<string, unknown>,
    getHistoryCountById: () => () => 8,
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    isModelHasExtendParams: () => () => false,
    modelDisabledParams: () => () => undefined,
  },
  useAiInfraStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  systemAgentSelectors: {
    followUpAction: () => ({ enabled: true, model: 'gpt-5.5', provider: 'openai' }),
  },
}));

vi.mock('@/components/InfoTooltip', () => ({ default: () => <span /> }));
vi.mock('@/components/NeuralNetworkLoading', () => ({ default: () => <span /> }));
vi.mock('@/features/ModelSwitchPanel/components/ControlsForm', () => ({
  default: () => <div data-testid="model-controls-form" />,
}));

/** Rows that write admin-owned `params` — hidden for a platform-managed agent. */
const PARAM_ROW_TITLES = [
  'settingModel.params.panel.creativity',
  'settingModel.params.panel.openness',
  'settingModel.params.panel.vocabularyRichness',
  'settingModel.params.panel.topicDivergence',
  'settingModel.params.panel.responseLength',
  'settingModel.reasoningEffort.title',
];

/** Rows that write the user's own `chatConfig` — always available. */
const CHAT_CONFIG_ROW_TITLES = [
  'settingModel.params.panel.contextCompression',
  'settingModel.params.panel.historyLimit',
  'settingChat.enableAutoScrollOnStreaming.title',
  'settingChat.enableStreaming.title',
  'settingChat.enableFollowUpChips.title',
  'settingChat.inputTemplate.title',
];

const renderControls = () => render(<Controls setUpdating={() => {}} updating={false} />);

describe('Params Controls', () => {
  beforeEach(() => {
    mocks.agentId = 'agent-1';
    mocks.enableAgentMode = false;
    mocks.isPlatformManaged = false;
    mocks.updateAgentConfig.mockClear();
    // The advanced section is collapsed by default and remembers its state locally.
    localStorage.setItem(ADVANCED_OPEN_STORAGE_KEY, 'true');
  });

  describe('ordinary agent', () => {
    it('renders both the chatConfig rows and the model-params section', () => {
      renderControls();

      for (const title of CHAT_CONFIG_ROW_TITLES) {
        expect(screen.getByText(title)).toBeInTheDocument();
      }
      for (const title of PARAM_ROW_TITLES) {
        expect(screen.getByText(title)).toBeInTheDocument();
      }
      expect(screen.getByText('settingModel.params.panel.advanced')).toBeInTheDocument();
    });

    it('shows no managed hint', () => {
      renderControls();

      expect(screen.queryByText(chatCopy['modelSwitch.managedByAdmin'])).toBeNull();
    });
  });

  describe('platform-managed agent', () => {
    beforeEach(() => {
      mocks.isPlatformManaged = true;
    });

    it('withholds every control that writes admin-owned params', () => {
      renderControls();

      for (const title of PARAM_ROW_TITLES) {
        expect(screen.queryByText(title)).toBeNull();
      }
      expect(screen.queryByText('settingModel.params.panel.advanced')).toBeNull();
    });

    it('keeps every chatConfig control the user still owns', () => {
      renderControls();

      for (const title of CHAT_CONFIG_ROW_TITLES) {
        expect(screen.getByText(title)).toBeInTheDocument();
      }
    });

    it('explains the missing section with the shared managed copy', () => {
      renderControls();

      expect(screen.getByText(chatCopy['modelSwitch.managedByAdmin'])).toBeInTheDocument();
    });

    it('writes nothing on render', () => {
      renderControls();

      expect(mocks.updateAgentConfig).not.toHaveBeenCalled();
    });
  });

  it('shows no managed hint in agent mode, where the params section is absent anyway', () => {
    mocks.enableAgentMode = true;
    mocks.isPlatformManaged = true;

    renderControls();

    expect(screen.queryByText(chatCopy['modelSwitch.managedByAdmin'])).toBeNull();
    expect(screen.queryByText('settingModel.params.panel.creativity')).toBeNull();
  });
});
