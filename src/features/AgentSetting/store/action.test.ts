/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_META } from '@/const/meta';
import { DEFAULT_AGENT_CONFIG } from '@/const/settings';

import { createStore } from './index';

vi.mock('@/services/chat', () => ({
  chatService: { fetchPresetTaskResult: vi.fn() },
}));

/**
 * Identity fields the platform default assistant owns. The server rejects a write that merely
 * mentions one of them, so a save must never carry the fields the user did not edit.
 */
const IDENTITY_KEYS = ['avatar', 'systemRole', 'title'];

const setup = () => {
  const onConfigChange = vi.fn();
  const onMetaChange = vi.fn();
  const useStore = createStore();

  useStore.setState({
    config: {
      ...DEFAULT_AGENT_CONFIG,
      plugins: ['plugin-a'],
      systemRole: 'admin-owned prompt',
      title: 'Default assistant',
    },
    meta: { ...DEFAULT_AGENT_META, avatar: '🤖', title: 'Default assistant' },
    onConfigChange,
    onMetaChange,
  });

  return { onConfigChange, onMetaChange, useStore };
};

describe('AgentSetting store actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('dispatchConfig', () => {
    it('saves only the updated fields, keeping the merged config in local state', async () => {
      const { onConfigChange, useStore } = setup();

      await useStore.getState().setAgentConfig({ openingMessage: 'hello' });

      expect(onConfigChange).toHaveBeenCalledWith({ openingMessage: 'hello' });
      // The store still holds the whole effective config for the form to render.
      expect(useStore.getState().config.openingMessage).toBe('hello');
      expect(useStore.getState().config.systemRole).toBe('admin-owned prompt');
    });

    it('saves a chatConfig edit without any identity field', async () => {
      const { onConfigChange, useStore } = setup();

      await useStore.getState().setChatConfig({ enableHistoryCount: true });

      expect(onConfigChange).toHaveBeenCalledWith({ chatConfig: { enableHistoryCount: true } });

      const patch = onConfigChange.mock.calls[0][0];
      for (const key of IDENTITY_KEYS) expect(patch).not.toHaveProperty(key);
    });

    it('saves only the plugin list when a plugin is toggled', async () => {
      const { onConfigChange, useStore } = setup();

      useStore.getState().toggleAgentPlugin('plugin-b');
      await vi.waitFor(() => expect(onConfigChange).toHaveBeenCalled());

      const patch = onConfigChange.mock.calls[0][0];
      expect(Object.keys(patch)).toEqual(['plugins']);
      expect(patch.plugins).toEqual(['plugin-a', { identifier: 'plugin-b', mode: 'pinned' }]);
      expect(useStore.getState().config.plugins).toEqual(patch.plugins);
    });

    it('saves the whole config on a reset, which rewrites every field on purpose', async () => {
      const { onConfigChange, useStore } = setup();

      await useStore.getState().resetAgentConfig();

      expect(onConfigChange).toHaveBeenCalledWith(DEFAULT_AGENT_CONFIG);
    });
  });

  describe('dispatchMeta', () => {
    it('saves only the updated meta field', async () => {
      const { onMetaChange, useStore } = setup();

      await useStore.getState().dispatchMeta({ type: 'update', value: { description: 'a bot' } });

      expect(onMetaChange).toHaveBeenCalledWith({ description: 'a bot' });
      expect(useStore.getState().meta.title).toBe('Default assistant');
    });

    it('saves the whole meta on a reset', async () => {
      const { onMetaChange, useStore } = setup();

      await useStore.getState().resetAgentMeta();

      expect(onMetaChange).toHaveBeenCalledWith(DEFAULT_AGENT_META);
    });
  });
});
