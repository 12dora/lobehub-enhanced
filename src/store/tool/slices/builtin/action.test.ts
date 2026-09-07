import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as workspaceHooks from '@/business/client/hooks/useActiveWorkspaceId';
import { message } from '@/components/AntdStaticMethods';
import * as swr from '@/libs/swr';
import { userService } from '@/services/user';

import { useToolStore } from '../../store';

vi.mock('zustand/traditional');

vi.mock('@/components/AntdStaticMethods', () => ({
  message: { error: vi.fn(), success: vi.fn() },
}));

describe('createBuiltinToolSlice', () => {
  describe('transformApiArgumentsToAiState', () => {
    it('should return early if the tool is already loading', async () => {
      // Given
      const key = 'mockTool';
      const params = { test: 'data' };

      const mockFn = vi.fn();
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          builtinToolLoading: { [key]: true },
          mockTool: mockFn,
        } as any);
      });

      await act(async () => {
        // When
        const data = await result.current.transformApiArgumentsToAiState(key, params);
        expect(data).toBeUndefined();
      });

      // Then - should not call the action if already loading
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should invoke the specified tool action and return the stringified result', async () => {
      // Given
      const key = 'mockTool';
      const mockResult = { success: true, data: 'test result' };
      const mockFn = vi.fn().mockResolvedValue(mockResult);
      const { result } = renderHook(() => useToolStore());

      const params = {
        input: 'test input',
        option: 'value',
      };

      act(() => {
        useToolStore.setState({
          builtinToolLoading: { [key]: false },
          mockTool: mockFn,
        } as any);
      });

      // When
      let resultData: string | undefined;
      await act(async () => {
        resultData = await result.current.transformApiArgumentsToAiState(key, params);
      });

      // Then
      expect(mockFn).toHaveBeenCalledWith({
        input: 'test input',
        option: 'value',
      });
      expect(resultData).toBe(JSON.stringify(mockResult));
    });

    it('should return stringified params if action does not exist', async () => {
      // Given
      const key = 'nonExistentTool';
      const params = { test: 'data' };
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          builtinToolLoading: {},
        });
      });

      // When
      let resultData: string | undefined;
      await act(async () => {
        resultData = await result.current.transformApiArgumentsToAiState(key, params);
      });

      // Then
      expect(resultData).toBe(JSON.stringify(params));
    });

    it('should handle errors and toggle loading state', async () => {
      // Given
      const key = 'mockTool';
      const params = { test: 'data' };
      const error = new Error('Tool execution failed');
      const mockFn = vi.fn().mockRejectedValue(error);
      const { result } = renderHook(() => useToolStore());

      act(() => {
        useToolStore.setState({
          builtinToolLoading: { [key]: false },
          mockTool: mockFn,
        } as any);
      });

      // When/Then
      await act(async () => {
        await expect(result.current.transformApiArgumentsToAiState(key, params)).rejects.toThrow(
          'Tool execution failed',
        );
      });

      // Should have toggled loading state back to false
      expect(result.current.builtinToolLoading[key]).toBe(false);
    });
  });

  describe('uninstalled builtin tools (workspace-scoped)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const mockUserState = (tool: any) =>
      vi.spyOn(userService, 'getUserState').mockResolvedValue({ settings: { tool } } as any);

    it('installBuiltinTool (personal) writes the personal list and preserves other tool settings', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({
        humanIntervention: { approvalMode: 'manual' },
        uninstalledBuiltinTools: ['a', 'b'],
      });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.installBuiltinTool('a');
      });

      expect(updateSpy).toHaveBeenCalledWith({
        tool: {
          humanIntervention: { approvalMode: 'manual' },
          uninstalledBuiltinTools: ['b'],
        },
      });
    });

    it('uninstallBuiltinTool (workspace) writes only the per-workspace slot, leaving personal untouched', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue('ws-1');
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({
        uninstalledBuiltinTools: ['personal-tool'],
        uninstalledBuiltinToolsByWorkspace: { 'ws-1': [] },
      });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.uninstallBuiltinTool('x');
      });

      expect(updateSpy).toHaveBeenCalledWith({
        tool: {
          uninstalledBuiltinTools: ['personal-tool'],
          uninstalledBuiltinToolsByWorkspace: { 'ws-1': ['x'] },
        },
      });
    });

    it('install in a workspace reads from the per-workspace slot, not the personal list', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue('ws-1');
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      // 'x' is uninstalled in the workspace; the personal list is unrelated.
      mockUserState({
        uninstalledBuiltinTools: ['a'],
        uninstalledBuiltinToolsByWorkspace: { 'ws-1': ['x', 'y'] },
      });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.installBuiltinTool('x');
      });

      expect(updateSpy).toHaveBeenCalledWith({
        tool: {
          uninstalledBuiltinTools: ['a'],
          uninstalledBuiltinToolsByWorkspace: { 'ws-1': ['y'] },
        },
      });
    });
  });

  describe('setSkillEnabled', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const mockUserState = (tool: any) =>
      vi.spyOn(userService, 'getUserState').mockResolvedValue({ settings: { tool } } as any);

    it('writes the personal disabled list for an installed skill', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({
        humanIntervention: { approvalMode: 'manual' },
        uninstalledBuiltinTools: ['a'],
      });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.setSkillEnabled({
          enabled: false,
          identifier: 'my-skill',
          kind: 'skill',
        });
      });

      expect(updateSpy).toHaveBeenCalledWith({
        tool: {
          disabledSkillIdentifiers: ['my-skill'],
          humanIntervention: { approvalMode: 'manual' },
          uninstalledBuiltinTools: ['a'],
        },
      });
      expect(result.current.disabledSkillIdentifiers).toEqual(['my-skill']);
    });

    it('writes only the per-workspace disabled slot, leaving the personal one untouched', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue('ws-1');
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({
        disabledSkillIdentifiers: ['personal-skill'],
        disabledSkillIdentifiersByWorkspace: { 'ws-1': ['ws-skill'] },
      });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.setSkillEnabled({
          enabled: true,
          identifier: 'ws-skill',
          kind: 'skill',
        });
      });

      expect(updateSpy).toHaveBeenCalledWith({
        tool: {
          disabledSkillIdentifiers: ['personal-skill'],
          disabledSkillIdentifiersByWorkspace: { 'ws-1': [] },
        },
      });
    });

    it('routes the builtin kind to the uninstalled builtin list', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({ uninstalledBuiltinTools: [] });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.setSkillEnabled({
          enabled: false,
          identifier: 'lobe-artifacts',
          kind: 'builtin',
        });
      });

      expect(updateSpy).toHaveBeenCalledWith({
        tool: { uninstalledBuiltinTools: ['lobe-artifacts'] },
      });
    });

    it('serializes concurrent toggles so the later write keeps the earlier one', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      // Stale on purpose: the read never reflects the write already in flight,
      // so only the queue can keep the first identifier.
      mockUserState({ disabledSkillIdentifiers: [], uninstalledBuiltinTools: [] });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await Promise.all([
          result.current.setSkillEnabled({
            enabled: false,
            identifier: 'skill-a',
            kind: 'skill',
          }),
          result.current.setSkillEnabled({
            enabled: false,
            identifier: 'skill-b',
            kind: 'skill',
          }),
        ]);
      });

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(updateSpy.mock.calls.at(-1)?.[0]).toEqual({
        tool: { disabledSkillIdentifiers: ['skill-a', 'skill-b'], uninstalledBuiltinTools: [] },
      });
      expect(result.current.disabledSkillIdentifiers).toEqual(['skill-a', 'skill-b']);
    });

    it('shares one queue between the builtin and the skill slot', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({ disabledSkillIdentifiers: [], uninstalledBuiltinTools: [] });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await Promise.all([
          result.current.setSkillEnabled({
            enabled: false,
            identifier: 'lobe-artifacts',
            kind: 'builtin',
          }),
          result.current.setSkillEnabled({
            enabled: false,
            identifier: 'my-skill',
            kind: 'skill',
          }),
        ]);
      });

      // The skill write must carry the builtin write that landed just before it.
      expect(updateSpy.mock.calls.at(-1)?.[0]).toEqual({
        tool: {
          disabledSkillIdentifiers: ['my-skill'],
          uninstalledBuiltinTools: ['lobe-artifacts'],
        },
      });
    });

    it('rolls the optimistic state back and reports a failed write', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({ disabledSkillIdentifiers: [] });
      vi.spyOn(userService, 'updateUserSettings').mockRejectedValue(new Error('offline'));
      vi.mocked(message.error).mockClear();

      const { result } = renderHook(() => useToolStore());
      act(() => {
        useToolStore.setState({ disabledSkillIdentifiers: [] });
      });

      await act(async () => {
        await expect(
          result.current.setSkillEnabled({
            enabled: false,
            identifier: 'my-skill',
            kind: 'skill',
          }),
        ).rejects.toThrow('offline');
      });

      expect(result.current.disabledSkillIdentifiers).toEqual([]);
      expect(message.error).toHaveBeenCalledTimes(1);
    });

    it('rolls the builtin list back when the write fails', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({ uninstalledBuiltinTools: [] });
      vi.spyOn(userService, 'updateUserSettings').mockRejectedValue(new Error('offline'));

      const { result } = renderHook(() => useToolStore());
      act(() => {
        useToolStore.setState({ uninstalledBuiltinTools: [] });
      });

      await act(async () => {
        await expect(
          result.current.setSkillEnabled({
            enabled: false,
            identifier: 'lobe-artifacts',
            kind: 'builtin',
          }),
        ).rejects.toThrow('offline');
      });

      expect(result.current.uninstalledBuiltinTools).toEqual([]);
    });

    it('is a no-op when the skill is already in the desired state', async () => {
      vi.spyOn(workspaceHooks, 'getActiveWorkspaceId').mockReturnValue(null);
      vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as any);
      mockUserState({ disabledSkillIdentifiers: ['my-skill'] });
      const updateSpy = vi
        .spyOn(userService, 'updateUserSettings')
        .mockResolvedValue(undefined as any);

      const { result } = renderHook(() => useToolStore());
      await act(async () => {
        await result.current.setSkillEnabled({
          enabled: false,
          identifier: 'my-skill',
          kind: 'skill',
        });
      });

      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('toggleBuiltinToolLoading', () => {
    it('should toggle the loading state for a tool', () => {
      const { result } = renderHook(() => useToolStore());
      const key = 'testTool';

      act(() => {
        result.current.toggleBuiltinToolLoading(key, true);
      });

      expect(result.current.builtinToolLoading[key]).toBe(true);

      act(() => {
        result.current.toggleBuiltinToolLoading(key, false);
      });

      expect(result.current.builtinToolLoading[key]).toBe(false);
    });
  });
});
