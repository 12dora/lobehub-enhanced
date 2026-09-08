/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import chatCopy from '@/locales/default/chat';

import Controls from './Controls';

const ADVANCED_OPEN_STORAGE_KEY = 'lobehub-chat-input-params-advanced-open';

/**
 * The identity fields are part of the effective config the panel's form holds: the server rejects
 * a patch that so much as mentions them on the platform-managed inbox, so every assertion below
 * checks the exact patch shape rather than "was called".
 */
const mocks = vi.hoisted(() => ({
  agentId: 'agent-1',
  config: {
    avatar: 'https://example.com/avatar.png',
    chatConfig: { enableHistoryCount: true, historyCount: 8 },
    params: { temperature: 0.7 },
    slug: 'inbox',
    systemRole: 'admin-owned prompt',
    title: 'Default assistant',
  } as Record<string, unknown>,
  enableAgentMode: false,
  isPlatformManaged: false,
  modelLocked: undefined as boolean | undefined,
  updateAgentChatConfig: vi.fn(),
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
  useUpdateAgentConfig: () => ({
    updateAgentChatConfig: mocks.updateAgentChatConfig,
    updateAgentConfig: mocks.updateAgentConfig,
  }),
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
    // Mirrors the real selector: a managed agent is model-locked unless the server marked its
    // platform config as defaults-only (`platform.modelLocked === false`).
    isAgentModelLockedById: () => () => mocks.isPlatformManaged && mocks.modelLocked !== false,
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

/** Clicks the switch of the row carrying `title`. */
const toggleRowSwitch = (title: string) => {
  const row = screen.getByText(title).closest('.control-row');
  if (!row) throw new Error(`no control row for "${title}"`);

  fireEvent.click(within(row as HTMLElement).getByRole('switch'));
};

describe('Params Controls', () => {
  beforeEach(() => {
    mocks.agentId = 'agent-1';
    mocks.enableAgentMode = false;
    mocks.isPlatformManaged = false;
    mocks.modelLocked = undefined;
    mocks.updateAgentChatConfig.mockClear();
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

  /**
   * Managed is not the same as pinned: only `platform.modelLocked !== false` locks the params.
   * The field is absent here, which is the back-compatible "pinned" reading.
   */
  describe('platform-managed agent', () => {
    beforeEach(() => {
      mocks.isPlatformManaged = true;
    });

    it('withholds the params section just the same when the pin is explicit', () => {
      mocks.modelLocked = true;

      renderControls();

      for (const title of PARAM_ROW_TITLES) {
        expect(screen.queryByText(title)).toBeNull();
      }
      expect(screen.getByText(chatCopy['modelSwitch.managedByAdmin'])).toBeInTheDocument();
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

  /**
   * `platform.modelLocked === false`: the platform version only seeds model parameters (the
   * default inbox under light management), so the member tunes them as on an own agent.
   */
  describe('managed agent whose params are only defaults', () => {
    beforeEach(() => {
      mocks.isPlatformManaged = true;
      mocks.modelLocked = false;
    });

    it('renders the model-params section like an ordinary agent', () => {
      renderControls();

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

  /**
   * A whole-form submit carried the agent's identity along with the edited field, which the
   * server rejects on the platform-managed inbox — every handler must send its own field only.
   */
  describe('submitted patch', () => {
    it('sends only the toggled chatConfig key, through the chatConfig updater', async () => {
      renderControls();

      toggleRowSwitch('settingModel.params.panel.historyLimit');

      await waitFor(
        () => {
          expect(mocks.updateAgentChatConfig).toHaveBeenCalledWith({ enableHistoryCount: false });
        },
        { timeout: 3000 },
      );
      expect(mocks.updateAgentChatConfig).toHaveBeenCalledTimes(1);
      expect(mocks.updateAgentConfig).not.toHaveBeenCalled();
    });

    it('sends only the disabled model parameter, with no identity field', async () => {
      renderControls();

      toggleRowSwitch('settingModel.params.panel.creativity');

      await waitFor(
        () => {
          expect(mocks.updateAgentConfig).toHaveBeenCalledWith({ params: { temperature: null } });
        },
        { timeout: 3000 },
      );

      const patch = mocks.updateAgentConfig.mock.calls[0][0];
      for (const key of ['avatar', 'chatConfig', 'slug', 'systemRole', 'title']) {
        expect(patch).not.toHaveProperty(key);
      }
    });

    it('sends only the enabled model parameter and its default value', async () => {
      renderControls();

      toggleRowSwitch('settingModel.params.panel.openness');

      await waitFor(
        () => {
          expect(mocks.updateAgentConfig).toHaveBeenCalledWith({ params: { top_p: 1 } });
        },
        { timeout: 3000 },
      );
      expect(mocks.updateAgentChatConfig).not.toHaveBeenCalled();
    });

    /** The switch and the value it seeds are one edit, so they travel in one patch. */
    it('pairs the response-length switch with the max_tokens it seeds', async () => {
      renderControls();

      toggleRowSwitch('settingModel.params.panel.responseLength');

      await waitFor(
        () => {
          expect(mocks.updateAgentConfig).toHaveBeenCalledWith({
            chatConfig: { enableMaxTokens: true },
            params: { max_tokens: 4096 },
          });
        },
        { timeout: 3000 },
      );
      expect(mocks.updateAgentConfig).toHaveBeenCalledTimes(1);
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
