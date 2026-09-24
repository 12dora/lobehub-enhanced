import type { UIChatMessage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OperationStatus, OperationType } from '@/store/chat/slices/operation/types';

import {
  ApproveAllQueue,
  type ApproveAllQueueState,
  detectQueueInterruption,
  IDLE_APPROVE_ALL_STATE,
  isToolCallPending,
  type QueueOperation,
} from './approveAllQueue';

const NOW = 1000;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const toolRow = (id: string): UIChatMessage =>
  ({
    content: '',
    createdAt: 0,
    id,
    meta: {},
    pluginIntervention: { kind: 'approval', status: 'pending' },
    role: 'tool',
    updatedAt: 0,
  }) as unknown as UIChatMessage;

/**
 * A fake chat store bucket: tool rows + operations, with subscribers notified on
 * every write like zustand does.
 */
const createStore = (ids: string[] = ['t1', 't2', 't3']) => {
  let messages = ids.map(toolRow);
  let operations: QueueOperation[] = [];
  let seq = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    /** What `cancelOperation` does first: flag the op and notify, status still `running`. */
    abortOp: (id: string) => {
      operations = operations.map((op) => (op.id === id ? { ...op, isAborting: true } : op));
      notify();
    },
    finishOp: (id: string, status: OperationStatus = 'completed') => {
      operations = operations.map((op) => (op.id === id ? { ...op, status } : op));
      notify();
    },
    listenerCount: () => listeners.size,
    read: () => ({ messages, operations }),
    setError: (id: string) => {
      messages = messages.map((m) =>
        m.id === id ? ({ ...m, pluginError: { message: 'x' } } as any) : m,
      );
      notify();
    },
    setStatus: (id: string, status: 'approved' | 'pending' | 'rejected') => {
      messages = messages.map((m) =>
        m.id === id ? { ...m, pluginIntervention: { ...m.pluginIntervention, status } } : m,
      );
      notify();
    },
    startOp: (type: OperationType, messageId?: string, startTime = NOW + 1) => {
      seq += 1;
      const id = `op_${seq}`;
      operations = [...operations, { id, messageId, startTime, status: 'running', type }];
      notify();
      return id;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

type FakeStore = ReturnType<typeof createStore>;

const createQueue = (
  store: FakeStore,
  approve: (id: string) => Promise<void>,
  prepare?: (id: string, signal: AbortSignal) => Promise<void>,
) => {
  const states: ApproveAllQueueState[] = [];
  const onStop = vi.fn();
  const queue = new ApproveAllQueue({
    approve,
    now: () => NOW,
    onChange: (state) => states.push(state),
    onStop,
    prepare,
    read: store.read,
    subscribe: store.subscribe,
  });
  return { onStop, queue, states };
};

/**
 * Client runtime: `approveToolCalling` writes `approved` optimistically, runs the
 * tool locally and only resolves once the run parked again.
 */
const clientApprove = (store: FakeStore) => {
  const runs = new Map<string, ReturnType<typeof deferred>>();
  const approve = vi.fn(async (id: string) => {
    const run = deferred();
    runs.set(id, run);
    const approveOp = store.startOp('approveToolCalling', id);
    store.setStatus(id, 'approved');
    const runtimeOp = store.startOp('execAgentRuntime');
    await run.promise;
    store.finishOp(runtimeOp);
    store.finishOp(approveOp);
  });
  return { approve, park: (id: string) => runs.get(id)!.resolve() };
};

/**
 * Gateway: `approveToolCalling` starts a server resume op and resolves right
 * away; the call stays pending until the server's outcome refresh, and the op
 * ends when the server re-parks.
 */
const gatewayApprove = (store: FakeStore) => {
  const serverOps = new Map<string, string>();
  const approve = vi.fn(async (id: string) => {
    const approveOp = store.startOp('approveToolCalling', id);
    await Promise.resolve();
    serverOps.set(id, store.startOp('execServerAgentRuntime'));
    store.finishOp(approveOp);
  });
  return {
    approve,
    /** Server applied the approval, executed the tool and parked again. */
    reparkAfter: (id: string) => {
      store.setStatus(id, 'approved');
      store.finishOp(serverOps.get(id)!);
    },
    serverOp: (id: string) => serverOps.get(id)!,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ApproveAllQueue', () => {
  describe('client runtime', () => {
    it('approves the calls one after another, each once the previous run parked', async () => {
      const store = createStore();
      const client = clientApprove(store);
      const { onStop, queue, states } = createQueue(store, client.approve);

      queue.start(['t1', 't2', 't3']);
      await flush();

      expect(client.approve).toHaveBeenCalledTimes(1);
      expect(client.approve).toHaveBeenLastCalledWith('t1');
      expect(states.at(-1)).toEqual({
        activeToolMessageId: 't1',
        current: 1,
        running: true,
        total: 3,
      });

      // t1 already left `pending`, but its run is still going: nothing else yet.
      await flush();
      expect(client.approve).toHaveBeenCalledTimes(1);

      client.park('t1');
      await flush();
      expect(client.approve).toHaveBeenCalledTimes(2);
      expect(client.approve).toHaveBeenLastCalledWith('t2');
      expect(states.at(-1)).toMatchObject({ activeToolMessageId: 't2', current: 2 });

      client.park('t2');
      await flush();
      expect(client.approve).toHaveBeenCalledTimes(3);
      expect(client.approve).toHaveBeenLastCalledWith('t3');

      // The last call is decided as soon as it left `pending`.
      expect(onStop).toHaveBeenCalledWith('done');
      expect(queue.running).toBe(false);
      expect(states.at(-1)).toEqual(IDLE_APPROVE_ALL_STATE);
      expect(store.listenerCount()).toBe(0);

      client.park('t3');
      await flush();
      expect(client.approve).toHaveBeenCalledTimes(3);
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('waits for a run that is already going before the first approval', async () => {
      const store = createStore();
      const busyOp = store.startOp('execAgentRuntime', undefined, NOW - 10);
      const client = clientApprove(store);
      const { queue } = createQueue(store, client.approve);

      queue.start(['t1', 't2']);
      await flush();
      expect(client.approve).not.toHaveBeenCalled();

      store.finishOp(busyOp);
      await flush();
      expect(client.approve).toHaveBeenCalledWith('t1');
    });
  });

  describe('gateway runtime', () => {
    it('does not treat the resolved approve promise as "re-parked"', async () => {
      const store = createStore();
      const gateway = gatewayApprove(store);
      const { onStop, queue } = createQueue(store, gateway.approve);

      queue.start(['t1', 't2', 't3']);
      await flush();

      // Resolved already, t1 still pending, server op running → wait.
      expect(gateway.approve).toHaveBeenCalledTimes(1);
      expect(isToolCallPending(store.read().messages, 't1')).toBe(true);
      await flush();
      expect(gateway.approve).toHaveBeenCalledTimes(1);
      expect(onStop).not.toHaveBeenCalled();

      // Outcome refresh lands first; the server is still executing the tool.
      store.setStatus('t1', 'approved');
      await flush();
      expect(gateway.approve).toHaveBeenCalledTimes(1);

      store.finishOp(gateway.serverOp('t1'));
      await flush();
      expect(gateway.approve).toHaveBeenCalledTimes(2);
      expect(gateway.approve).toHaveBeenLastCalledWith('t2');

      gateway.reparkAfter('t2');
      await flush();
      expect(gateway.approve).toHaveBeenLastCalledWith('t3');

      store.setStatus('t3', 'approved');
      await flush();
      expect(onStop).toHaveBeenCalledWith('done');
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('stops when the server did not accept an approval (call still pending after the run)', async () => {
      const store = createStore();
      const gateway = gatewayApprove(store);
      const { onStop, queue } = createQueue(store, gateway.approve);

      queue.start(['t1', 't2']);
      await flush();

      store.finishOp(gateway.serverOp('t1'));
      await flush();

      expect(onStop).toHaveBeenCalledWith('failed');
      expect(gateway.approve).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopping', () => {
    it('stops when the approve operation failed', async () => {
      const store = createStore();
      const approve = vi.fn(async (id: string) => {
        const op = store.startOp('approveToolCalling', id);
        store.finishOp(op, 'failed');
      });
      const { onStop, queue } = createQueue(store, approve);

      queue.start(['t1', 't2']);
      await flush();

      expect(onStop).toHaveBeenCalledWith('failed');
      expect(approve).toHaveBeenCalledTimes(1);
    });

    it('stops when approve throws', async () => {
      const store = createStore();
      const approve = vi.fn(async () => {
        throw new Error('network');
      });
      const { onStop, queue } = createQueue(store, approve);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      queue.start(['t1', 't2']);
      await flush();

      expect(onStop).toHaveBeenCalledWith('failed', expect.any(Error));
      expect(approve).toHaveBeenCalledTimes(1);
    });

    it('stops when an approve resolves without doing anything (call still pending)', async () => {
      const store = createStore();
      const approve = vi.fn(async () => {});
      const { onStop, queue } = createQueue(store, approve);

      queue.start(['t1', 't2']);
      await flush();

      expect(onStop).toHaveBeenCalledWith('failed');
      expect(approve).toHaveBeenCalledTimes(1);
    });

    it('stops when the approved tool reported an error', async () => {
      const store = createStore();
      const client = clientApprove(store);
      const { onStop, queue } = createQueue(store, client.approve);

      queue.start(['t1', 't2']);
      await flush();
      store.setError('t1');
      client.park('t1');
      await flush();

      expect(onStop).toHaveBeenCalledWith('toolError');
      expect(client.approve).toHaveBeenCalledTimes(1);
    });

    it('stops on Stop (the running run gets cancelled)', async () => {
      const store = createStore();
      const gateway = gatewayApprove(store);
      const { onStop, queue } = createQueue(store, gateway.approve);

      queue.start(['t1', 't2']);
      await flush();

      store.finishOp(gateway.serverOp('t1'), 'cancelled');
      await flush();

      expect(onStop).toHaveBeenCalledWith('stopped');
      expect(gateway.approve).toHaveBeenCalledTimes(1);
    });

    it('stops as soon as the run is aborting, before it is cancelled', async () => {
      const store = createStore();
      const gateway = gatewayApprove(store);
      const { onStop, queue } = createQueue(store, gateway.approve);

      queue.start(['t1', 't2']);
      await flush();

      // Mid-run snapshot: t1 already shows approved and its approve settled.
      store.setStatus('t1', 'approved');
      // Stop: `isAborting` lands (and notifies) while the status is still `running`.
      store.abortOp(gateway.serverOp('t1'));
      await flush();

      expect(onStop).toHaveBeenCalledWith('stopped');
      expect(gateway.approve).toHaveBeenCalledTimes(1);

      store.finishOp(gateway.serverOp('t1'), 'cancelled');
      await flush();
      expect(gateway.approve).toHaveBeenCalledTimes(1);
    });

    it('treats a run that was already aborting when it started as busy', async () => {
      const store = createStore();
      const oldRun = store.startOp('execServerAgentRuntime', undefined, NOW - 10);
      store.abortOp(oldRun);
      const client = clientApprove(store);
      const { onStop, queue } = createQueue(store, client.approve);

      queue.start(['t1', 't2']);
      await flush();
      expect(client.approve).not.toHaveBeenCalled();
      expect(onStop).not.toHaveBeenCalled();

      store.finishOp(oldRun, 'cancelled');
      await flush();
      expect(client.approve).toHaveBeenCalledWith('t1');
    });

    it('stops when the user acts on another call manually', async () => {
      const store = createStore();
      const client = clientApprove(store);
      const { onStop, queue } = createQueue(store, client.approve);

      queue.start(['t1', 't2', 't3']);
      await flush();

      // e.g. the user rejects t2 on its own tab while t1 still runs.
      store.startOp('rejectToolCalling', 't2');
      await flush();

      expect(onStop).toHaveBeenCalledWith('manual');

      client.park('t1');
      await flush();
      expect(client.approve).toHaveBeenCalledTimes(1);
    });

    it('stops when the next call was decided elsewhere before its turn', async () => {
      const store = createStore();
      const client = clientApprove(store);
      const { onStop, queue } = createQueue(store, client.approve);

      queue.start(['t1', 't2']);
      await flush();

      // Decided on another surface (no operation in this conversation).
      store.setStatus('t2', 'rejected');
      client.park('t1');
      await flush();

      expect(onStop).toHaveBeenCalledWith('manual');
      expect(client.approve).toHaveBeenCalledTimes(1);
    });

    it('stop() ends the queue and ignores the in-flight approval afterwards', async () => {
      const store = createStore();
      const client = clientApprove(store);
      const { onStop, queue, states } = createQueue(store, client.approve);

      queue.start(['t1', 't2']);
      await flush();

      queue.stop();
      expect(onStop).toHaveBeenCalledWith('user');
      expect(states.at(-1)).toEqual(IDLE_APPROVE_ALL_STATE);
      expect(store.listenerCount()).toBe(0);

      client.park('t1');
      await flush();
      expect(client.approve).toHaveBeenCalledTimes(1);
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('ignores start() while running', async () => {
      const store = createStore();
      const client = clientApprove(store);
      const { queue } = createQueue(store, client.approve);

      queue.start(['t1', 't2']);
      queue.start(['t3']);
      await flush();

      expect(client.approve).toHaveBeenCalledTimes(1);
      expect(client.approve).toHaveBeenCalledWith('t1');
    });
  });
});

describe('ApproveAllQueue prepare (the card’s before-approve check)', () => {
  it('opens the call first and approves only after its check passed', async () => {
    const store = createStore(['t1', 't2']);
    const client = clientApprove(store);
    const checks = new Map<string, ReturnType<typeof deferred>>();
    const prepare = vi.fn((id: string) => {
      const check = deferred();
      checks.set(id, check);
      return check.promise;
    });
    const { onStop, queue, states } = createQueue(store, client.approve, prepare);

    queue.start(['t1', 't2']);
    await flush();

    // The tab is opened (active call emitted) while its preview still loads.
    expect(prepare).toHaveBeenCalledWith('t1', expect.any(AbortSignal));
    expect(states.at(-1)).toMatchObject({ activeToolMessageId: 't1', current: 1 });
    expect(client.approve).not.toHaveBeenCalled();

    checks.get('t1')!.resolve();
    await flush();
    expect(client.approve).toHaveBeenCalledWith('t1');

    client.park('t1');
    await flush();
    expect(prepare).toHaveBeenLastCalledWith('t2', expect.any(AbortSignal));
    expect(client.approve).toHaveBeenCalledTimes(1);

    checks.get('t2')!.resolve();
    await flush();
    expect(client.approve).toHaveBeenLastCalledWith('t2');
    expect(onStop).toHaveBeenCalledWith('done');
  });

  it('stops with the refusal when a check refuses', async () => {
    const store = createStore(['t1', 't2']);
    const client = clientApprove(store);
    const refusal = new Error('DINGTALK_PREVIEW_ERROR');
    const prepare = vi.fn(async () => {
      throw refusal;
    });
    const { onStop, queue } = createQueue(store, client.approve, prepare);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    queue.start(['t1', 't2']);
    await flush();

    expect(onStop).toHaveBeenCalledWith('failed', refusal);
    expect(client.approve).not.toHaveBeenCalled();
  });

  it('stops (and aborts the check) when the user decides the call while it is checked', async () => {
    const store = createStore(['t1', 't2']);
    const client = clientApprove(store);
    let signal: AbortSignal | undefined;
    const check = deferred();
    const prepare = vi.fn((_id: string, abortSignal: AbortSignal) => {
      signal = abortSignal;
      return check.promise;
    });
    const { onStop, queue } = createQueue(store, client.approve, prepare);

    queue.start(['t1', 't2']);
    await flush();

    // e.g. Enter on the card's own footer.
    store.startOp('approveToolCalling', 't1');
    await flush();

    expect(onStop).toHaveBeenCalledWith('manual');
    expect(signal?.aborted).toBe(true);

    check.resolve();
    await flush();
    expect(client.approve).not.toHaveBeenCalled();
  });

  it('stops when the call was decided elsewhere by the time its check passed', async () => {
    const store = createStore(['t1', 't2']);
    const client = clientApprove(store);
    const check = deferred();
    const { onStop, queue } = createQueue(store, client.approve, () => check.promise);

    queue.start(['t1', 't2']);
    await flush();

    store.setStatus('t1', 'rejected');
    check.resolve();
    await flush();

    expect(onStop).toHaveBeenCalledWith('manual');
    expect(client.approve).not.toHaveBeenCalled();
  });
});

describe('detectQueueInterruption', () => {
  const op = (overrides: Partial<QueueOperation>): QueueOperation => ({
    id: 'op',
    startTime: NOW + 1,
    status: 'running',
    type: 'execAgentRuntime',
    ...overrides,
  });
  const options = { dispatched: new Set(['t1']), since: NOW };

  it('ignores operations that started before the queue', () => {
    expect(
      detectQueueInterruption(
        [
          op({ startTime: NOW - 1, status: 'cancelled' }),
          op({ messageId: 't9', startTime: NOW - 1, type: 'rejectToolCalling' }),
        ],
        options,
      ),
    ).toBeUndefined();
  });

  it('ignores the queue’s own decisions', () => {
    expect(
      detectQueueInterruption([op({ messageId: 't1', type: 'approveToolCalling' })], options),
    ).toBeUndefined();
  });

  it.each([
    ['stopped', op({ status: 'cancelled', type: 'execServerAgentRuntime' })],
    ['stopped', op({ isAborting: true, type: 'execAgentRuntime' })],
    ['failed', op({ messageId: 't1', status: 'failed', type: 'approveToolCalling' })],
    ['manual', op({ messageId: 't2', type: 'cancelToolInteraction' })],
    ['manual', op({ messageId: 't2', type: 'approveToolCalling' })],
  ] as const)('reports %s', (reason, operation) => {
    expect(detectQueueInterruption([operation], options)).toBe(reason);
  });
});

describe('isToolCallPending', () => {
  it('reads grouped tool blocks by result message id', () => {
    const grouped = {
      children: [
        {
          tools: [
            { id: 'call_1', intervention: { status: 'pending' }, result_msg_id: 't1' },
            { id: 'call_2', intervention: { status: 'approved' }, result_msg_id: 't2' },
          ],
        },
      ],
      id: 'group',
      role: 'assistantGroup',
    } as unknown as UIChatMessage;

    expect(isToolCallPending([grouped], 't1')).toBe(true);
    expect(isToolCallPending([grouped], 't2')).toBe(false);
    expect(isToolCallPending([grouped], 'missing')).toBe(false);
  });
});
