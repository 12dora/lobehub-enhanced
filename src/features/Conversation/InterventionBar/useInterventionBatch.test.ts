import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import {
  markInterventionMounted,
  registerBeforeApproveCheck,
} from '../Messages/AssistantGroup/Tool/Detail/Intervention/beforeApproveRegistry';
import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { useInterventionBatch } from './useInterventionBatch';

const CANCEL_REASON = 'The user cancelled this action. It was not executed.';

const { approveToolCall, context, conversationDbMessages, toast } = vi.hoisted(() => ({
  approveToolCall: vi.fn<(toolMessageId: string, assistantGroupId: string) => Promise<void>>(),
  context: { agentId: 'agt_1', threadId: null, topicId: 'tpc_1' } as ConversationContext,
  // Raw rows the Conversation store holds: every call was emitted by `asst_1`.
  conversationDbMessages: ['t1', 't2', 't3', 't4'].map((id) => ({
    id,
    parentId: 'asst_1',
    role: 'tool',
  })),
  toast: { info: vi.fn(), warning: vi.fn() },
}));

const chatKey = messageMapKey(context);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast,
}));

vi.mock('../Messages/AssistantGroup/Tool/Detail/Intervention/CancelInterventionButton', () => ({
  CANCEL_INTERVENTION_REASON: 'The user cancelled this action. It was not executed.',
}));

vi.mock('../Messages/AssistantGroup/Tool/Detail/Intervention/customInteractionHandlers', () => ({
  isCustomInteractionIdentifier: () => false,
}));

vi.mock('../store', () => ({
  dataSelectors: {
    getDbMessageById: (id: string) => (state: { dbMessages: Array<{ id: string }> }) =>
      state.dbMessages.find((message) => message.id === id),
  },
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({ approveToolCall, context, dbMessages: conversationDbMessages }),
}));

const IDS = ['t1', 't2', 't3'];

const interventions: PendingIntervention[] = IDS.map((id) => ({
  apiName: 'completeTodo',
  assistantGroupId: 'grp_1',
  identifier: 'lobe-dingtalk-personal',
  intervention: { kind: 'approval', status: 'pending' },
  requestArgs: '{}',
  toolCallId: `call_${id}`,
  toolMessageId: id,
}));

const toolRow = (id: string) =>
  ({
    content: '',
    id,
    pluginIntervention: { kind: 'approval', status: 'pending' },
    role: 'tool',
    tool_call_id: `call_${id}`,
  }) as unknown as UIChatMessage;

const setStatus = (id: string, status: 'approved' | 'pending' | 'rejected') => {
  useChatStore.setState((state) => ({
    dbMessagesMap: {
      ...state.dbMessagesMap,
      [chatKey]: (state.dbMessagesMap[chatKey] ?? []).map((message) =>
        message.id === id
          ? { ...message, pluginIntervention: { ...message.pluginIntervention, status } }
          : message,
      ),
    },
  }));
};

const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

/** Client runtime: optimistic `approved`, local run, resolves once parked again. */
const mockClientRuntime = () => {
  const parks = new Map<string, () => void>();
  const runs = new Map<string, string>();
  approveToolCall.mockImplementation(async (id) => {
    const { completeOperation, startOperation } = useChatStore.getState();
    const { operationId } = startOperation({
      context: { ...context, messageId: id },
      type: 'approveToolCalling',
    });
    setStatus(id, 'approved');
    const { operationId: runId } = startOperation({ context, type: 'execAgentRuntime' });
    runs.set(id, runId);
    await new Promise<void>((resolve) => parks.set(id, resolve));
    completeOperation(runId);
    completeOperation(operationId);
  });
  return {
    park: (id: string) => act(() => parks.get(id)!()),
    runId: (id: string) => runs.get(id)!,
  };
};

/** Gateway: resolves as soon as the resume op started; the server re-parks later. */
const mockGatewayRuntime = () => {
  const serverOps = new Map<string, string>();
  approveToolCall.mockImplementation(async (id) => {
    const { completeOperation, startOperation } = useChatStore.getState();
    const { operationId } = startOperation({
      context: { ...context, messageId: id },
      type: 'approveToolCalling',
    });
    await Promise.resolve();
    const { operationId: gatewayOpId } = startOperation({
      context,
      type: 'execServerAgentRuntime',
    });
    serverOps.set(id, gatewayOpId);
    completeOperation(operationId);
  });
  return {
    /** The server ended the resume op; `approved` says whether the refresh shows it decided. */
    finish: (id: string, approved = true) =>
      act(() => {
        if (approved) setStatus(id, 'approved');
        useChatStore.getState().completeOperation(serverOps.get(id)!);
      }),
  };
};

const originalRejectAll = useChatStore.getState().rejectAllToolCallings;

/**
 * The bar shows each call's card while the queue works on it; here every card is
 * "on screen" without a before-approve check unless a test says otherwise.
 */
const unmountCard = new Map<string, () => void>();
const registryCleanups: Array<() => void> = [];

/**
 * Re-mount a call's card with a check, in React's order: the card registers in
 * its own effect, the host marks the card mounted in its (later) parent effect.
 */
const showCardWithCheck = (id: string, check: () => void) => {
  unmountCard.get(id)?.();
  const unregister = registerBeforeApproveCheck(id, 'confirm', check);
  unmountCard.set(id, markInterventionMounted(id));
  return unregister;
};

beforeEach(() => {
  for (const id of IDS) unmountCard.set(id, markInterventionMounted(id));
  approveToolCall.mockReset();
  toast.info.mockReset();
  toast.warning.mockReset();
  useChatStore.setState({
    dbMessagesMap: { [chatKey]: IDS.map(toolRow) },
    operations: {},
    operationsByContext: {},
    operationsByMessage: {},
    operationsByType: {},
  } as never);
});

afterEach(() => {
  useChatStore.setState({ rejectAllToolCallings: originalRejectAll } as never);
  for (const unmount of unmountCard.values()) unmount();
  unmountCard.clear();
  while (registryCleanups.length > 0) registryCleanups.pop()!();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useInterventionBatch', () => {
  it('batches the pending calls of the active turn', () => {
    const { result } = renderHook(() => useInterventionBatch(interventions, 0));

    expect(result.current.items.map((i) => i.toolMessageId)).toEqual(IDS);
    expect(result.current.progress).toBeUndefined();
  });

  describe('approve all', () => {
    it('client runtime: approves each call after the previous run parked', async () => {
      const client = mockClientRuntime();
      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      act(() => result.current.approveAll());
      await flush();

      expect(approveToolCall).toHaveBeenCalledTimes(1);
      expect(approveToolCall).toHaveBeenLastCalledWith('t1', 'grp_1');
      expect(result.current.progress).toEqual({ current: 1, mode: 'approve', total: 3 });
      expect(result.current.activeToolMessageId).toBe('t1');

      client.park('t1');
      await flush();
      expect(approveToolCall).toHaveBeenCalledTimes(2);
      expect(approveToolCall).toHaveBeenLastCalledWith('t2', 'grp_1');
      expect(result.current.progress).toEqual({ current: 2, mode: 'approve', total: 3 });

      client.park('t2');
      await flush();
      expect(approveToolCall).toHaveBeenCalledTimes(3);
      expect(approveToolCall).toHaveBeenLastCalledWith('t3', 'grp_1');

      // t3 left `pending`: the batch is decided.
      expect(result.current.progress).toBeUndefined();
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('gateway: waits for the server to re-park instead of the approve promise', async () => {
      const gateway = mockGatewayRuntime();
      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      act(() => result.current.approveAll());
      await flush();
      await flush();

      // The approve promise already resolved, the resume op still runs.
      expect(approveToolCall).toHaveBeenCalledTimes(1);

      gateway.finish('t1');
      await flush();
      expect(approveToolCall).toHaveBeenCalledTimes(2);
      expect(approveToolCall).toHaveBeenLastCalledWith('t2', 'grp_1');

      gateway.finish('t2');
      await flush();
      expect(approveToolCall).toHaveBeenLastCalledWith('t3', 'grp_1');

      act(() => setStatus('t3', 'approved'));
      expect(result.current.progress).toBeUndefined();
    });

    it('stops with a warning when an approval did not go through', async () => {
      const gateway = mockGatewayRuntime();
      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      act(() => result.current.approveAll());
      await flush();

      // Server refused (stale): the call is still pending when the op ends.
      gateway.finish('t1', false);
      await flush();

      expect(approveToolCall).toHaveBeenCalledTimes(1);
      expect(result.current.progress).toBeUndefined();
      expect(toast.warning).toHaveBeenCalledWith('tool.intervention.batch.stoppedOnFailure');
    });

    it('stops on Stop', async () => {
      const client = mockClientRuntime();
      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      act(() => result.current.approveAll());
      await flush();

      act(() => useChatStore.getState().cancelOperation(client.runId('t1')));
      await flush();
      expect(result.current.progress).toBeUndefined();

      client.park('t1');
      await flush();
      expect(approveToolCall).toHaveBeenCalledTimes(1);
    });

    it('stops when the user decides another call manually', async () => {
      const client = mockClientRuntime();
      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      act(() => result.current.approveAll());
      await flush();

      act(() => {
        useChatStore.getState().startOperation({
          context: { ...context, messageId: 't3' },
          type: 'cancelToolInteraction',
        });
      });
      await flush();

      expect(result.current.progress).toBeUndefined();
      expect(toast.info).toHaveBeenCalledWith('tool.intervention.batch.stoppedManual');

      client.park('t1');
      await flush();
      expect(approveToolCall).toHaveBeenCalledTimes(1);
    });

    it('stops from the header', async () => {
      const client = mockClientRuntime();
      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      act(() => result.current.approveAll());
      await flush();
      act(() => result.current.stopApproveAll());
      expect(result.current.progress).toBeUndefined();

      client.park('t1');
      await flush();
      expect(approveToolCall).toHaveBeenCalledTimes(1);
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('stops when the bar unmounts (navigation away)', async () => {
      const client = mockClientRuntime();
      const { result, unmount } = renderHook(() => useInterventionBatch(interventions, 0));

      act(() => result.current.approveAll());
      await flush();
      unmount();

      client.park('t1');
      await flush();
      expect(approveToolCall).toHaveBeenCalledTimes(1);
    });
  });

  describe("the card's before-approve check", () => {
    it('waits for a loading preview, then runs the check and approves', async () => {
      mockClientRuntime();
      // t1's confirm card is on screen, its preview still loading.
      const loading = vi.fn(() => {
        throw new Error('DINGTALK_PERSONAL_PREVIEW_LOADING');
      });
      const unregisterLoading = showCardWithCheck('t1', loading);

      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      act(() => result.current.approveAll());
      await flush();
      expect(result.current.progress).toEqual({ current: 1, mode: 'approve', total: 3 });
      expect(approveToolCall).not.toHaveBeenCalled();

      // Preview arrived: the card swaps its check in one commit.
      const ready = vi.fn();
      act(() => {
        unregisterLoading();
        registryCleanups.push(registerBeforeApproveCheck('t1', 'confirm', ready));
      });
      await flush();

      expect(ready).toHaveBeenCalledTimes(1);
      expect(loading).not.toHaveBeenCalled();
      expect(approveToolCall).toHaveBeenCalledWith('t1', 'grp_1');
    });

    it('stops without approving when the check refuses', async () => {
      mockClientRuntime();
      const unregisterLoading = showCardWithCheck('t1', () => {
        throw new Error('DINGTALK_PERSONAL_PREVIEW_LOADING');
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      act(() => result.current.approveAll());
      await flush();

      // Preview failed (NOT_FOUND / auth): the card now refuses.
      act(() => {
        unregisterLoading();
        registryCleanups.push(
          registerBeforeApproveCheck('t1', 'confirm', () => {
            throw new Error('DINGTALK_PERSONAL_PREVIEW_ERROR');
          }),
        );
      });
      await flush();

      expect(approveToolCall).not.toHaveBeenCalled();
      expect(result.current.progress).toBeUndefined();
      expect(toast.warning).toHaveBeenCalledWith('tool.intervention.batch.checkRefused');
    });

    it('stops with the preview-timeout message when the card never becomes approvable', async () => {
      vi.useFakeTimers();
      mockClientRuntime();
      // t1's card never shows up.
      unmountCard.get('t1')!();
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      act(() => result.current.approveAll());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(19_000);
      });
      expect(result.current.progress).toBeDefined();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(approveToolCall).not.toHaveBeenCalled();
      expect(result.current.progress).toBeUndefined();
      expect(toast.warning).toHaveBeenCalledWith('tool.intervention.batch.previewTimeout');
    });
  });

  describe('reject all', () => {
    it('rejects the batch through rejectAllToolCallings with the cancel reason', async () => {
      let finish!: () => void;
      const rejectAll = vi.fn(
        (_ids: string[], options: { onProgress?: (rejected: number, total: number) => void }) =>
          new Promise<{ rejected: number; resumed: boolean; total: number }>((resolve) => {
            options.onProgress?.(1, 3);
            finish = () => resolve({ rejected: 3, resumed: true, total: 3 });
          }),
      );
      useChatStore.setState({ rejectAllToolCallings: rejectAll } as never);

      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      let pending!: Promise<void>;
      act(() => {
        pending = result.current.rejectAll();
      });

      expect(rejectAll).toHaveBeenCalledWith(IDS, {
        cancelReason: CANCEL_REASON,
        context,
        onProgress: expect.any(Function),
        resume: true,
      });
      expect(result.current.progress).toEqual({ current: 2, mode: 'reject', total: 3 });

      // Approve-all is locked meanwhile.
      act(() => result.current.approveAll());
      expect(approveToolCall).not.toHaveBeenCalled();

      await act(async () => {
        finish();
        await pending;
      });

      expect(result.current.progress).toBeUndefined();
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('leaves a blacklisted call of the same turn out and keeps the run parked for it', async () => {
      const rejectAll = vi.fn().mockResolvedValue({ rejected: 3, resumed: false, total: 3 });
      useChatStore.setState({ rejectAllToolCallings: rejectAll } as never);
      const withDangerous: PendingIntervention[] = [
        ...interventions,
        {
          apiName: 'runCommand',
          assistantGroupId: 'grp_1',
          identifier: 'lobe-local-system',
          intervention: { kind: 'approval', status: 'pending' },
          requestArgs: JSON.stringify({ command: 'rm -rf /' }),
          toolCallId: 'call_t4',
          toolMessageId: 't4',
        },
      ];

      const { result } = renderHook(() => useInterventionBatch(withDangerous, 0));
      expect(result.current.items.map((i) => i.toolMessageId)).toEqual(IDS);

      await act(() => result.current.rejectAll());

      expect(rejectAll).toHaveBeenCalledWith(IDS, expect.objectContaining({ resume: false }));
      // Everything asked for was rejected; the run waits for t4 on purpose.
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('warns when the batch could not be rejected completely', async () => {
      useChatStore.setState({
        rejectAllToolCallings: vi.fn().mockResolvedValue({ rejected: 1, resumed: false, total: 3 }),
      } as never);

      const { result } = renderHook(() => useInterventionBatch(interventions, 0));

      await act(() => result.current.rejectAll());

      expect(toast.warning).toHaveBeenCalledWith('tool.intervention.batch.rejectIncomplete');
    });
  });
});
