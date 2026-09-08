import { afterEach, describe, expect, it, vi } from 'vitest';

import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { type AgentStoreState } from '@/store/agent/initialState';
import { initialAgentSliceState } from '@/store/agent/slices/agent/initialState';
import { initialBuiltinAgentSliceState } from '@/store/agent/slices/builtin/initialState';

import { agentByIdSelectors } from './agentByIdSelectors';

// getAgentWorkingDirectoryById is desktop-only; force the desktop branch on.
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

const createState = (overrides: Partial<AgentStoreState> = {}): AgentStoreState => ({
  ...initialAgentSliceState,
  ...initialBuiltinAgentSliceState,
  ...overrides,
});

describe('agentByIdSelectors', () => {
  describe('getAgentBuilderContextById', () => {
    it('should return builder context from existing agent config', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { historyCount: 6 },
            model: 'gpt-4o',
            plugins: ['search'],
            provider: 'openai',
            systemRole: 'You are a helper',
          },
        },
      });

      const context = agentByIdSelectors.getAgentBuilderContextById('agent-1')(state);

      expect(context.config).toMatchObject({
        chatConfig: { historyCount: 6 },
        model: 'gpt-4o',
        plugins: ['search'],
        provider: 'openai',
        systemRole: 'You are a helper',
      });
    });

    it('should not throw when agent config is missing', () => {
      const state = createState({ agentMap: {} });

      expect(() =>
        agentByIdSelectors.getAgentBuilderContextById('missing-agent')(state),
      ).not.toThrow();

      const context = agentByIdSelectors.getAgentBuilderContextById('missing-agent')(state);

      expect(context.config).toMatchObject({
        chatConfig: undefined,
        model: undefined,
        // getActivePluginIds always normalizes to an array, even for a
        // missing/undefined raw plugins field.
        plugins: [],
        provider: undefined,
        systemRole: undefined,
      });
    });

    it('excludes disabled entries from the builder context plugins, in a mixed-shape array', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            model: 'gpt-4o',
            plugins: ['search', { identifier: 'lobe-web-browsing', mode: 'disabled' }],
            provider: 'openai',
            systemRole: 'You are a helper',
          } as any,
        },
      });

      const context = agentByIdSelectors.getAgentBuilderContextById('agent-1')(state);

      expect(context.config).toMatchObject({ plugins: ['search'] });
    });
  });

  describe('agent mode', () => {
    it('should default to agent mode when enableAgentMode is not explicitly false', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: {},
            model: 'gpt-4o',
            provider: 'openai',
          },
        },
      });

      expect(agentByIdSelectors.getAgentModeById('agent-1')(state)).toBe('auto');
      expect(agentByIdSelectors.getAgentEnableModeById('agent-1')(state)).toBe(true);
    });

    it('should keep the agent in agent mode when agent mode is enabled', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { enableAgentMode: true },
            model: 'claude-opus-4-8',
            provider: 'lobehub',
          },
        },
      });

      expect(agentByIdSelectors.getAgentModeById('agent-1')(state)).toBe('auto');
      expect(agentByIdSelectors.getAgentEnableModeById('agent-1')(state)).toBe(true);
    });
  });

  describe('getAgentWorkingDirectoryById', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const stateWith = (config: Record<string, any>, localMap: Record<string, string> = {}) =>
      createState({
        agentMap: { 'agent-1': config },
        localAgentWorkingDirectoryMap: localMap,
      });

    it('reads the per-device choice for the current (local) device', () => {
      vi.spyOn(globalAgentContextManager, 'getContext').mockReturnValue({ homePath: '/home/me' });
      const state = stateWith({
        agencyConfig: { workingDirByDevice: { 'device-A': '/repos/agent-gateway' } },
      });

      expect(agentByIdSelectors.getAgentWorkingDirectoryById('agent-1', 'device-A')(state)).toBe(
        '/repos/agent-gateway',
      );
    });

    it('reads the bound device choice when the agent targets a device', () => {
      vi.spyOn(globalAgentContextManager, 'getContext').mockReturnValue({ homePath: '/home/me' });
      const state = stateWith({
        agencyConfig: {
          boundDeviceId: 'device-B',
          executionTarget: 'device',
          workingDirByDevice: { 'device-A': '/repos/local', 'device-B': '/repos/remote' },
        },
      });

      // currentDeviceId is the local machine, but executionTarget=device → device-B wins
      expect(agentByIdSelectors.getAgentWorkingDirectoryById('agent-1', 'device-A')(state)).toBe(
        '/repos/remote',
      );
    });

    it('falls back to the legacy per-agent value when no device choice exists', () => {
      vi.spyOn(globalAgentContextManager, 'getContext').mockReturnValue({ homePath: '/home/me' });
      const state = stateWith({ agencyConfig: {} }, { 'agent-1': '/repos/legacy' });

      expect(agentByIdSelectors.getAgentWorkingDirectoryById('agent-1', 'device-A')(state)).toBe(
        '/repos/legacy',
      );
    });

    it('falls back to desktop/home path when nothing is set', () => {
      vi.spyOn(globalAgentContextManager, 'getContext').mockReturnValue({
        desktopPath: '/home/me/Desktop',
        homePath: '/home/me',
      });
      const state = stateWith({ agencyConfig: {} });

      expect(agentByIdSelectors.getAgentWorkingDirectoryById('agent-1', 'device-A')(state)).toBe(
        '/home/me/Desktop',
      );
    });
  });

  describe('getAgentConfigErrorById', () => {
    it('returns the recorded error for the agent', () => {
      const state = createState({ agentConfigErrorMap: { 'agent-1': 'boom' } });

      expect(agentByIdSelectors.getAgentConfigErrorById('agent-1')(state)).toBe('boom');
    });

    it('returns undefined for another agent or an empty id', () => {
      const state = createState({ agentConfigErrorMap: { 'agent-1': 'boom' } });

      expect(agentByIdSelectors.getAgentConfigErrorById('agent-2')(state)).toBeUndefined();
      expect(agentByIdSelectors.getAgentConfigErrorById('')(state)).toBeUndefined();
    });
  });

  describe('isAgentPlatformManagedById', () => {
    it('returns true only when the config carries the platform managed marker', () => {
      const state = createState({
        agentMap: {
          'managed-agent': {
            model: 'gpt-4o',
            platform: { distribution: 'mandatory', managed: true, source: 'platform' },
          },
          'own-agent': { model: 'gpt-4o' },
        },
      });

      expect(agentByIdSelectors.isAgentPlatformManagedById('managed-agent')(state)).toBe(true);
      expect(agentByIdSelectors.isAgentPlatformManagedById('own-agent')(state)).toBe(false);
    });

    it('returns false for an unknown agent or an empty id', () => {
      const state = createState({ agentMap: {} });

      expect(agentByIdSelectors.isAgentPlatformManagedById('missing')(state)).toBe(false);
      expect(agentByIdSelectors.isAgentPlatformManagedById('')(state)).toBe(false);
    });
  });

  describe('isAgentModelLockedById', () => {
    const managedWith = (modelLocked?: boolean) => ({
      model: 'gpt-4o',
      platform: { managed: true as const, modelLocked, source: 'platform' as const },
    });

    it('locks a managed agent whose payload omits modelLocked', () => {
      const state = createState({ agentMap: { 'managed-agent': managedWith() } });

      expect(agentByIdSelectors.isAgentModelLockedById('managed-agent')(state)).toBe(true);
    });

    it('locks a managed agent pinned with modelLocked true', () => {
      const state = createState({ agentMap: { 'managed-agent': managedWith(true) } });

      expect(agentByIdSelectors.isAgentModelLockedById('managed-agent')(state)).toBe(true);
    });

    it('leaves the model editable when the platform only supplies defaults', () => {
      const state = createState({ agentMap: { 'managed-agent': managedWith(false) } });

      expect(agentByIdSelectors.isAgentModelLockedById('managed-agent')(state)).toBe(false);
      // identity fields stay admin-owned even then
      expect(agentByIdSelectors.isAgentPlatformManagedById('managed-agent')(state)).toBe(true);
    });

    it('returns false for an own agent, an unknown agent or an empty id', () => {
      const state = createState({ agentMap: { 'own-agent': { model: 'gpt-4o' } } });

      expect(agentByIdSelectors.isAgentModelLockedById('own-agent')(state)).toBe(false);
      expect(agentByIdSelectors.isAgentModelLockedById('missing')(state)).toBe(false);
      expect(agentByIdSelectors.isAgentModelLockedById('')(state)).toBe(false);
    });
  });

  describe('getAgentTTSVoiceById', () => {
    it('returns the configured openai voice', () => {
      const state = createState({
        agentMap: {
          'agent-1': { tts: { ttsService: 'openai', voice: { openai: 'nova' } } },
        },
      });

      expect(agentByIdSelectors.getAgentTTSVoiceById('agent-1')(state)).toBe('nova');
    });

    it('falls back to a default voice when the agent config is missing', () => {
      const state = createState({ agentMap: {} });

      expect(agentByIdSelectors.getAgentTTSVoiceById('missing')(state)).toBe('alloy');
    });
  });
});
