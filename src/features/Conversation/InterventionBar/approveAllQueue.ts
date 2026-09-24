import type { ConversationContext, ToolIntervention, UIChatMessage } from '@lobechat/types';

import type { ChatStoreState } from '@/store/chat/initialState';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import {
  AI_RUNTIME_OPERATION_TYPES,
  INPUT_LOADING_OPERATION_TYPES,
  type OperationStatus,
  type OperationType,
} from '@/store/chat/slices/operation/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/**
 * Approve-all queue for the InterventionBar.
 *
 * One assistant turn can park several tool calls at once. Each approval resumes
 * the run for exactly one call (`approveToolCalling` → one `human_approved_tool`
 * step), and the run re-parks while siblings are still pending. So "approve all"
 * is a sequence: approve one, wait until the run has settled back into the
 * parked state, approve the next.
 *
 * The queue never trusts the approve promise to mean "the run re-parked": in the
 * client runtime it resolves after the local run parked, but in Gateway mode it
 * resolves as soon as the resume op is started — the server executes the tool and
 * re-parks later. Progress is therefore driven by chat store state only:
 *
 * - the dispatched call left `pending` (optimistic write / server refresh), and
 * - no run / resume / decision operation is running in the conversation, and
 * - the approve promise has settled.
 *
 * Before approving a call the queue opens its tab and runs `prepare` — the
 * card's own before-approve check (see `beforeApproveRegistry`) — exactly like
 * the card's approve button would.
 *
 * It stops (and never resumes by itself) on any failure, on Stop, and as soon as
 * someone else decides one of the calls (the user on a tab, Esc, another surface).
 */

/** Operations that resolve one pending intervention. */
const DECISION_OPERATION_TYPES = new Set<OperationType>([
  'approveToolCalling',
  'cancelToolInteraction',
  'rejectToolCalling',
  'skipToolInteraction',
  'submitToolInteraction',
]);

/** While any of these runs the conversation is still moving — never dispatch over it. */
const BUSY_OPERATION_TYPES = new Set<OperationType>([
  ...INPUT_LOADING_OPERATION_TYPES,
  ...DECISION_OPERATION_TYPES,
]);

/** A cancel (Stop) or failure of one of these ends the queue. */
const RUN_OPERATION_TYPES = new Set<OperationType>([
  ...AI_RUNTIME_OPERATION_TYPES,
  'approveToolCalling',
]);

export type ApproveAllStopReason =
  /** Every queued call was approved. */
  | 'done'
  /** An approval did not go through (operation failed, call still pending afterwards). */
  | 'failed'
  /** Someone else decided a queued call (a tab's own actions, Esc, another surface). */
  | 'manual'
  /** A run of this conversation was stopped. */
  | 'stopped'
  /** An approved call ran but its tool reported an error. */
  | 'toolError'
  /** The bar went away or switched conversation. */
  | 'unmounted'
  /** The user pressed stop on the batch header. */
  | 'user';

export interface ApproveAllQueueState {
  /** Tool message the queue is currently approving (or about to). */
  activeToolMessageId?: string;
  /** 1-based position of that call in the queue. */
  current: number;
  running: boolean;
  total: number;
}

export const IDLE_APPROVE_ALL_STATE: ApproveAllQueueState = {
  current: 0,
  running: false,
  total: 0,
};

/** The slice of an operation the queue looks at. */
export interface QueueOperation {
  id: string;
  isAborting?: boolean;
  /** `context.messageId`: the tool message a decision operation targets. */
  messageId?: string;
  startTime: number;
  status: OperationStatus;
  type: OperationType;
}

export interface QueueStoreView {
  /** Raw messages of the conversation (chat store `dbMessagesMap` bucket). */
  messages: UIChatMessage[];
  /** Operations of the conversation. */
  operations: QueueOperation[];
}

interface ToolCallRow {
  error?: unknown;
  status?: ToolIntervention['status'];
}

/**
 * The tool call behind a tool message: a flat `role: 'tool'` row, or — for
 * grouped messages — the tool block whose `result_msg_id` points at it.
 */
const findToolCallRow = (
  messages: UIChatMessage[],
  toolMessageId: string,
): ToolCallRow | undefined => {
  const row = messages.find((message) => message.id === toolMessageId);
  if (row) {
    return {
      error: row.pluginError ?? row.error ?? undefined,
      status: row.pluginIntervention?.status,
    };
  }

  for (const message of messages) {
    for (const block of message.children ?? []) {
      const tool = block.tools?.find((item) => item.result_msg_id === toolMessageId);
      if (tool)
        return { error: tool.result?.error ?? undefined, status: tool.intervention?.status };
    }
  }

  return undefined;
};

export const isToolCallPending = (messages: UIChatMessage[], toolMessageId: string): boolean =>
  findToolCallRow(messages, toolMessageId)?.status === 'pending';

export const hasToolCallError = (messages: UIChatMessage[], toolMessageId: string): boolean =>
  !!findToolCallRow(messages, toolMessageId)?.error;

/**
 * Something is still moving in the conversation. A run that is being aborted
 * still counts: it has not reached its terminal state yet.
 */
export const isConversationBusy = (operations: QueueOperation[]): boolean =>
  operations.some((op) => BUSY_OPERATION_TYPES.has(op.type) && op.status === 'running');

/**
 * Why the queue must stop, judged from operations started since it began.
 */
export const detectQueueInterruption = (
  operations: QueueOperation[],
  { dispatched, since }: { dispatched: ReadonlySet<string>; since: number },
): Extract<ApproveAllStopReason, 'failed' | 'manual' | 'stopped'> | undefined => {
  const recent = operations.filter((op) => op.startTime >= since);

  // Stop flags a run `isAborting` (and notifies) before it flips to `cancelled`:
  // react to the first signal, or a snapshot taken in between would look idle.
  if (
    recent.some(
      (op) => RUN_OPERATION_TYPES.has(op.type) && (op.status === 'cancelled' || !!op.isAborting),
    )
  )
    return 'stopped';

  if (recent.some((op) => RUN_OPERATION_TYPES.has(op.type) && op.status === 'failed'))
    return 'failed';

  if (
    recent.some(
      (op) =>
        DECISION_OPERATION_TYPES.has(op.type) && !!op.messageId && !dispatched.has(op.messageId),
    )
  )
    return 'manual';

  return undefined;
};

/**
 * Chat store → queue view for one conversation. The chat store is read (not the
 * Conversation store) because it is the source of truth: the Conversation store
 * mirrors it one render later, and reading the mirror could see a call still
 * pending after its run already settled.
 */
export const readQueueStoreView = (
  state: ChatStoreState,
  context: ConversationContext,
): QueueStoreView => ({
  messages: state.dbMessagesMap[messageMapKey(context)] ?? [],
  operations: operationSelectors
    .getOperationsByContext(context)(state)
    .map((op) => ({
      id: op.id,
      isAborting: op.metadata.isAborting,
      messageId: op.context.messageId,
      startTime: op.metadata.startTime,
      status: op.status,
      type: op.type,
    })),
});

export interface ApproveAllQueueDeps {
  /** Approve one tool call (the same action a tab's own approve button uses). */
  approve: (toolMessageId: string) => Promise<void>;
  now?: () => number;
  onChange: (state: ApproveAllQueueState) => void;
  /** `error`: what made a `failed` stop (a refused / timed-out check, a thrown approve). */
  onStop?: (reason: ApproveAllStopReason, error?: unknown) => void;
  /**
   * Runs before each approval once the call's tab is open — the card's own
   * before-approve check. Rejecting stops the queue (`failed`); aborted when the
   * queue stops.
   */
  prepare?: (toolMessageId: string, signal: AbortSignal) => Promise<void>;
  read: () => QueueStoreView;
  /** Subscribe to chat store changes; returns the unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}

interface InFlight {
  id: string;
  settled: boolean;
}

export class ApproveAllQueue {
  readonly #deps: ApproveAllQueueDeps;
  #abort: AbortController | undefined;
  #cursor = 0;
  #dirty = false;
  #dispatched = new Set<string>();
  #evaluating = false;
  #ids: string[] = [];
  #inFlight: InFlight | undefined;
  #running = false;
  #since = 0;
  /** Bumped on every start / stop so late promise callbacks of an old run are ignored. */
  #token = 0;
  #unsubscribe: (() => void) | undefined;

  constructor(deps: ApproveAllQueueDeps) {
    this.#deps = deps;
  }

  get running(): boolean {
    return this.#running;
  }

  start = (toolMessageIds: string[]): void => {
    if (this.#running) return;

    const ids = [...new Set(toolMessageIds)];
    if (ids.length === 0) return;

    this.#ids = ids;
    this.#cursor = 0;
    this.#dispatched = new Set();
    this.#inFlight = undefined;
    this.#running = true;
    this.#since = (this.#deps.now ?? Date.now)();
    this.#token += 1;
    this.#unsubscribe = this.#deps.subscribe(this.evaluate);

    this.#emit();
    this.evaluate();
  };

  stop = (reason: ApproveAllStopReason = 'user', error?: unknown): void => {
    if (!this.#running) return;

    this.#running = false;
    this.#token += 1;
    this.#inFlight = undefined;
    this.#abort?.abort();
    this.#abort = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;

    this.#deps.onChange(IDLE_APPROVE_ALL_STATE);
    if (error === undefined) this.#deps.onStop?.(reason);
    else this.#deps.onStop?.(reason, error);
  };

  /** Re-check the store; called on every chat store change while running. */
  evaluate = (): void => {
    if (!this.#running) return;

    // `approve` may write to the store synchronously, which notifies subscribers
    // (us) again from inside a step. Re-run afterwards instead of re-entering.
    if (this.#evaluating) {
      this.#dirty = true;
      return;
    }

    this.#evaluating = true;
    try {
      do {
        this.#dirty = false;
        const stopReason = this.#step();
        if (stopReason) this.stop(stopReason);
      } while (this.#dirty && this.#running);
    } finally {
      this.#evaluating = false;
    }
  };

  /** One pass over the store: dispatches the next call, or returns why the queue must stop. */
  #step(): ApproveAllStopReason | undefined {
    const { messages, operations } = this.#deps.read();

    const interruption = detectQueueInterruption(operations, {
      dispatched: this.#dispatched,
      since: this.#since,
    });
    if (interruption) return interruption;

    const busy = isConversationBusy(operations);

    if (this.#inFlight) {
      const { id, settled } = this.#inFlight;
      const pending = isToolCallPending(messages, id);

      // Nothing is dispatched after the last call, so it needs no quiet period:
      // once it is no longer pending, the batch is decided.
      if (!pending && this.#cursor === this.#ids.length - 1) return 'done';

      // Gateway: the promise resolves before the server re-parks — wait for the
      // resume op to finish. Client: wait for the local run to park.
      if (!settled || busy) return;

      if (pending) return 'failed';
      if (hasToolCallError(messages, id)) return 'toolError';

      this.#inFlight = undefined;
      this.#cursor += 1;
    }

    if (this.#cursor >= this.#ids.length) return 'done';
    if (busy) return;

    const next = this.#ids[this.#cursor];
    // Decided by someone else before its turn came.
    if (!isToolCallPending(messages, next)) return 'manual';

    this.#dispatch(next);
  }

  #dispatch(id: string): void {
    const token = this.#token;
    const abort = new AbortController();
    this.#abort = abort;
    this.#inFlight = { id, settled: false };
    // Emitting the call makes the bar open its tab, which mounts its card.
    this.#emit();

    const run = async () => {
      await this.#deps.prepare?.(id, abort.signal);
      if (token !== this.#token) return;

      // Decided elsewhere while its card was being checked.
      if (!isToolCallPending(this.#deps.read().messages, id)) {
        this.stop('manual');
        return;
      }

      // From here on a decision operation for this call is ours, not a manual one.
      this.#dispatched.add(id);
      await this.#deps.approve(id);
    };

    run().then(
      () => {
        const inFlight = this.#inFlight;
        if (token !== this.#token || !inFlight || inFlight.id !== id) return;
        inFlight.settled = true;
        this.evaluate();
      },
      (error) => {
        if (token !== this.#token) return;
        console.error('[ApproveAllQueue] approve failed:', error);
        this.stop('failed', error);
      },
    );
  }

  #emit(): void {
    const total = this.#ids.length;
    this.#deps.onChange({
      activeToolMessageId: this.#inFlight?.id ?? this.#ids[this.#cursor],
      current: Math.min(this.#cursor + 1, total),
      running: true,
      total,
    });
  }
}
