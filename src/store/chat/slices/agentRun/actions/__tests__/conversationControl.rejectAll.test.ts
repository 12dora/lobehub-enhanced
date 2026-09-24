import { type ConversationContext, type ToolIntervention } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { createMockMessage, createMockResolvedAgentConfig } from './fixtures';
import { resetTestEnvironment } from './helpers';

// Same isolation as conversationControl.test.ts.
vi.mock('zustand/traditional');

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      processHumanIntervention: { mutate: vi.fn().mockResolvedValue({ success: true }) },
      submitHeteroIntervention: { mutate: vi.fn().mockResolvedValue({ success: true }) },
    },
  },
}));

vi.mock('@/services/agentRuntime', () => ({
  agentRuntimeService: {
    handleHumanIntervention: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/utils/localStorage', () => {
  class AsyncLocalStorage<State> {
    async getFromLocalStorage(): Promise<State> {
      return {} as State;
    }

    async saveToLocalStorage(): Promise<void> {
      return undefined;
    }
  }

  return { AsyncLocalStorage };
});

const CANCEL_REASON = 'The user cancelled this action. It was not executed.';

const agentId = 'batch-agent';
const topicId = 'batch-topic';
const context: ConversationContext = { agentId, topicId };
const chatKey = messageMapKey(context);

type RejectAllResult = Awaited<
  ReturnType<ReturnType<typeof useChatStore.getState>['rejectAllToolCallings']>
>;

const toolMessage = (id: string, status: ToolIntervention['status'] = 'pending') =>
  createMockMessage({
    content: '',
    id,
    parentId: 'assistant-1',
    plugin: { apiName: 'completeTodo', arguments: '{}', identifier: 'lobe-dingtalk-personal' },
    pluginIntervention: { kind: 'approval', status },
    role: 'tool',
    tool_call_id: `call_${id}`,
  } as any);

/** Mirror a local intervention write into the conversation bucket. */
const writeIntervention = (id: string, intervention: Partial<ToolIntervention>) => {
  useChatStore.setState((state) => ({
    dbMessagesMap: {
      ...state.dbMessagesMap,
      [chatKey]: (state.dbMessagesMap[chatKey] ?? []).map((message) =>
        message.id === id
          ? { ...message, pluginIntervention: { ...message.pluginIntervention, ...intervention } }
          : message,
      ),
    },
  }));
};

const statusOf = (id: string) =>
  useChatStore.getState().dbMessagesMap[chatKey]?.find((m) => m.id === id)?.pluginIntervention
    ?.status;

/** One assistant turn that parked three approvals (optionally some already decided). */
const seed = (statuses: ToolIntervention['status'][] = ['pending', 'pending', 'pending']) => {
  const { result } = renderHook(() => useChatStore());
  const messages = [
    createMockMessage({ id: 'assistant-1', role: 'assistant' }),
    ...statuses.map((status, index) => toolMessage(`t${index + 1}`, status)),
  ];

  act(() => {
    useChatStore.setState({
      activeAgentId: agentId,
      activeThreadId: undefined,
      activeTopicId: topicId,
      dbMessagesMap: { [chatKey]: messages },
      messagesMap: { [chatKey]: messages },
      updateTopicStatus: vi.fn().mockResolvedValue(undefined),
    });
  });

  return result;
};

/** Spies for the client runtime: local writes land in the store, the agent run is stubbed. */
const spyClientRuntime = (result: { current: ReturnType<typeof useChatStore.getState> }) => {
  vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
  vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockImplementation(
    async (id, value) => {
      if (value.intervention) writeIntervention(id, value.intervention);
    },
  );
  vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
  vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
    agentConfig: createMockResolvedAgentConfig(),
    context: { phase: 'init' } as any,
    state: {} as any,
  });

  return {
    cancelToolInteraction: vi.spyOn(result.current, 'cancelToolInteraction'),
    executeClientAgent: vi.spyOn(result.current, 'executeClientAgent').mockResolvedValue(undefined),
    executeGatewayAgent: vi
      .spyOn(result.current, 'executeGatewayAgent')
      .mockResolvedValue({} as any),
  };
};

/** Spies for Gateway: `cancelToolInteraction` stands in for the server CAS. */
const spyGatewayRuntime = (
  result: { current: ReturnType<typeof useChatStore.getState> },
  options: { casWins?: boolean } = {},
) => {
  vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);

  return {
    cancelToolInteraction: vi
      .spyOn(result.current, 'cancelToolInteraction')
      .mockImplementation(async (id, reason) => {
        if (options.casWins === false) return;
        writeIntervention(id, { rejectedReason: reason, status: 'rejected' });
      }),
    executeClientAgent: vi.spyOn(result.current, 'executeClientAgent').mockResolvedValue(undefined),
    executeGatewayAgent: vi
      .spyOn(result.current, 'executeGatewayAgent')
      .mockResolvedValue({} as any),
    rejectToolCalling: vi.spyOn(result.current, 'rejectToolCalling'),
  };
};

const rejectAll = async (
  result: { current: ReturnType<typeof useChatStore.getState> },
  ids: string[],
  onProgress?: (rejected: number, total: number) => void,
  resume?: boolean,
) => {
  let outcome!: RejectAllResult;
  await act(async () => {
    outcome = await result.current.rejectAllToolCallings(ids, {
      cancelReason: CANCEL_REASON,
      context,
      onProgress,
      resume,
    });
  });
  return outcome;
};

beforeEach(() => {
  resetTestEnvironment();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rejectAllToolCallings', () => {
  describe('client runtime', () => {
    it('rejects every row and runs the agent exactly once, from the last row', async () => {
      const result = seed();
      const spies = spyClientRuntime(result);
      const onProgress = vi.fn();

      const outcome = await rejectAll(result, ['t1', 't2', 't3'], onProgress);

      expect(outcome).toEqual({ rejected: 3, resumed: true, total: 3 });
      expect(['t1', 't2', 't3'].map(statusOf)).toEqual(['rejected', 'rejected', 'rejected']);

      expect(spies.executeClientAgent).toHaveBeenCalledTimes(1);
      expect(spies.executeClientAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({ phase: 'user_input' }),
          parentMessageId: 't3',
        }),
      );
      expect(spies.executeGatewayAgent).not.toHaveBeenCalled();
      expect(spies.cancelToolInteraction).not.toHaveBeenCalled();
      expect(onProgress.mock.calls).toEqual([
        [1, 3],
        [2, 3],
        [3, 3],
      ]);
    });

    it('skips rows that are no longer pending', async () => {
      const result = seed(['pending', 'approved', 'pending']);
      const spies = spyClientRuntime(result);

      const outcome = await rejectAll(result, ['t1', 't2', 't3']);

      expect(outcome).toEqual({ rejected: 2, resumed: true, total: 2 });
      expect(statusOf('t2')).toBe('approved');
      expect(spies.executeClientAgent).toHaveBeenCalledTimes(1);
    });

    it('stops without resuming when a row cannot be rejected', async () => {
      const result = seed();
      const spies = spyClientRuntime(result);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockImplementation(
        async (id, value) => {
          if (id === 't2') throw new Error('network');
          if (value.intervention) writeIntervention(id, value.intervention);
        },
      );

      const outcome = await rejectAll(result, ['t1', 't2', 't3']);

      expect(outcome).toEqual({ rejected: 1, resumed: false, total: 3 });
      expect(statusOf('t3')).toBe('pending');
      expect(spies.executeClientAgent).not.toHaveBeenCalled();
    });

    it('resume: false rejects every row and leaves the run parked', async () => {
      const result = seed();
      const spies = spyClientRuntime(result);

      const outcome = await rejectAll(result, ['t1', 't2', 't3'], undefined, false);

      expect(outcome).toEqual({ rejected: 3, resumed: false, total: 3 });
      expect(['t1', 't2', 't3'].map(statusOf)).toEqual(['rejected', 'rejected', 'rejected']);
      expect(spies.executeClientAgent).not.toHaveBeenCalled();
      expect(spies.executeGatewayAgent).not.toHaveBeenCalled();
    });

    it('does nothing when no row is pending', async () => {
      const result = seed(['approved', 'rejected', 'approved']);
      const spies = spyClientRuntime(result);

      const outcome = await rejectAll(result, ['t1', 't2', 't3']);

      expect(outcome).toEqual({ rejected: 0, resumed: false, total: 0 });
      expect(spies.executeClientAgent).not.toHaveBeenCalled();
    });
  });

  describe('gateway', () => {
    it('closes all but the last row without a resume and sends a single rejected_continue', async () => {
      const result = seed();
      const spies = spyGatewayRuntime(result);

      const outcome = await rejectAll(result, ['t1', 't2', 't3']);

      expect(outcome).toEqual({ rejected: 3, resumed: true, total: 3 });

      expect(spies.cancelToolInteraction).toHaveBeenCalledTimes(2);
      expect(spies.cancelToolInteraction).toHaveBeenNthCalledWith(1, 't1', CANCEL_REASON, context);
      expect(spies.cancelToolInteraction).toHaveBeenNthCalledWith(2, 't2', CANCEL_REASON, context);
      // A Gateway `rejectToolCalling` is itself a resume op: never used here.
      expect(spies.rejectToolCalling).not.toHaveBeenCalled();

      expect(spies.executeGatewayAgent).toHaveBeenCalledTimes(1);
      expect(spies.executeGatewayAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentMessageId: 't3',
          resumeApproval: expect.objectContaining({
            decision: 'rejected_continue',
            parentMessageId: 't3',
            toolCallId: 'call_t3',
          }),
        }),
      );
      expect(spies.executeClientAgent).not.toHaveBeenCalled();
    });

    it('resume: false closes every row through the CAS without any resume op', async () => {
      const result = seed();
      const spies = spyGatewayRuntime(result);

      const outcome = await rejectAll(result, ['t1', 't2', 't3'], undefined, false);

      expect(outcome).toEqual({ rejected: 3, resumed: false, total: 3 });
      expect(spies.cancelToolInteraction).toHaveBeenCalledTimes(3);
      expect(spies.executeGatewayAgent).not.toHaveBeenCalled();
    });

    it('stops without resuming when a row was decided elsewhere (lost CAS)', async () => {
      const result = seed();
      const spies = spyGatewayRuntime(result, { casWins: false });

      const outcome = await rejectAll(result, ['t1', 't2', 't3']);

      expect(outcome).toEqual({ rejected: 0, resumed: false, total: 3 });
      expect(spies.cancelToolInteraction).toHaveBeenCalledTimes(1);
      expect(spies.executeGatewayAgent).not.toHaveBeenCalled();
    });
  });
});
