/**
 * Shared registry of intervention cards' before-approve checks, keyed by tool
 * message id.
 *
 * A builtin intervention card registers a check through the host's
 * `registerBeforeApprove` (flush in-card edits, or — DingTalk confirm cards —
 * refuse until the server preview for these exact args loaded). The card's own
 * approve button runs its checks through the host (`Intervention`), exactly as
 * before. The host also mirrors every check here, so "approve all" can run the
 * same check for each call it approves instead of approving around it.
 *
 * A host marks the tool message "mounted" while an approvable body is on screen
 * (see `markInterventionMounted`). Hosts mark in a parent effect, which React
 * runs after the card's own effects — so once a message is mounted, the checks
 * a card registers on mount are already here, and "mounted without checks"
 * really means the card has none.
 */

export type BeforeApproveCallback = () => void | Promise<void>;

export interface BeforeApproveCheckOptions {
  /**
   * The card knows its check would refuse only because data is still loading.
   * A check that never reports this is probed (see `runBeforeApproveWhenReady`).
   */
  pending?: boolean;
}

interface CheckEntry {
  callback: BeforeApproveCallback;
  checkId: string;
  pending?: boolean;
}

interface MessageChecks {
  /** When the checks last changed. */
  changedAt: number;
  entries: CheckEntry[];
  /** Mounted approvable bodies for this tool message. */
  hosts: number;
  mountedAt: number;
  /** `version` when a host last mounted. */
  mountedVersion: number;
  /** Changes on every check registration / removal (globally increasing, never reused). */
  version: number;
}

const registry = new Map<string, MessageChecks>();
const listeners = new Set<() => void>();
let versionSeq = 0;

const notify = () => {
  for (const listener of listeners) listener();
};

const ensureMessage = (messageId: string): MessageChecks => {
  let state = registry.get(messageId);
  if (!state) {
    const now = Date.now();
    state = {
      changedAt: now,
      entries: [],
      hosts: 0,
      mountedAt: now,
      mountedVersion: 0,
      version: 0,
    };
    registry.set(messageId, state);
  }
  return state;
};

const pruneMessage = (messageId: string) => {
  const state = registry.get(messageId);
  if (state && state.hosts === 0 && state.entries.length === 0) registry.delete(messageId);
};

/**
 * Register one check of a tool message's card. Registering the same `checkId`
 * again replaces it. The returned cleanup removes exactly this registration.
 */
export const registerBeforeApproveCheck = (
  messageId: string,
  checkId: string,
  callback: BeforeApproveCallback,
  options?: BeforeApproveCheckOptions,
): (() => void) => {
  const state = ensureMessage(messageId);
  const entry: CheckEntry = { callback, checkId, pending: options?.pending };

  state.entries = [...state.entries.filter((item) => item.checkId !== checkId), entry];
  versionSeq += 1;
  state.version = versionSeq;
  state.changedAt = Date.now();
  notify();

  return () => {
    const current = registry.get(messageId);
    if (!current?.entries.includes(entry)) return;

    current.entries = current.entries.filter((item) => item !== entry);
    versionSeq += 1;
    current.version = versionSeq;
    current.changedAt = Date.now();
    pruneMessage(messageId);
    notify();
  };
};

/**
 * Mark an approvable body of this tool message as on screen. Call it from the
 * host's own effect (after the card's effects ran); returns the unmark cleanup.
 */
export const markInterventionMounted = (messageId: string): (() => void) => {
  const state = ensureMessage(messageId);
  state.hosts += 1;
  state.mountedVersion = state.version;
  state.mountedAt = Date.now();
  notify();

  let unmarked = false;
  return () => {
    if (unmarked) return;
    unmarked = true;

    const current = registry.get(messageId);
    if (!current) return;
    current.hosts = Math.max(0, current.hosts - 1);
    pruneMessage(messageId);
    notify();
  };
};

export const subscribeBeforeApprove = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export interface BeforeApproveSnapshot {
  /** The checks changed after the card mounted — cards re-register when their state changes. */
  changedSinceMount: boolean;
  checkCount: number;
  mounted: boolean;
  /** A check reported it is still loading. */
  pending: boolean;
  /** How long the checks and the card have been unchanged (ms). */
  quietFor: number;
  version: number;
}

export const getBeforeApproveSnapshot = (
  messageId: string,
  now: number = Date.now(),
): BeforeApproveSnapshot => {
  const state = registry.get(messageId);
  if (!state) {
    return {
      changedSinceMount: false,
      checkCount: 0,
      mounted: false,
      pending: false,
      quietFor: 0,
      version: 0,
    };
  }

  return {
    changedSinceMount: state.version > state.mountedVersion,
    checkCount: state.entries.length,
    mounted: state.hosts > 0,
    pending: state.entries.some((entry) => entry.pending),
    quietFor: now - Math.max(state.changedAt, state.mountedAt),
    version: state.version,
  };
};

/** Run every registered check of a tool message once; rejects with the first refusal. */
export const runBeforeApproveChecks = async (messageId: string): Promise<void> => {
  const entries = registry.get(messageId)?.entries ?? [];
  await Promise.all(entries.map((entry) => entry.callback()));
};

/** The card never became approvable (not shown, or its data never loaded) in time. */
export class BeforeApproveTimeoutError extends Error {
  constructor(messageId: string) {
    super(`Before-approve check of ${messageId} did not become ready in time`);
    this.name = 'BeforeApproveTimeoutError';
  }
}

/** A card's own check refused the approval (its card already says why). */
export class BeforeApproveRefusedError extends Error {
  readonly reason: unknown;

  constructor(reason: unknown) {
    super(
      `Before-approve check refused: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
    this.name = 'BeforeApproveRefusedError';
    this.reason = reason;
  }
}

/**
 * A check that refused only because its data is still loading. DingTalk confirm
 * cards throw `…PREVIEW_LOADING` until the preview for these args arrived (and
 * re-register their check once it did).
 */
export const isBeforeApprovePendingError = (error: unknown): boolean =>
  error instanceof Error && error.message.endsWith('PREVIEW_LOADING');

export interface RunBeforeApproveWhenReadyOptions {
  /**
   * A check that never reported its state is probed once it re-registered after
   * mount (its state changed) or stayed unchanged this long.
   */
  settleMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const BEFORE_APPROVE_SETTLE_MS = 2000;
export const BEFORE_APPROVE_TIMEOUT_MS = 20_000;

/**
 * Wait until the tool message's card is on screen and its checks can answer,
 * then run them — the same checks the card's own approve button runs.
 *
 * - card mounted without checks → resolves right away;
 * - a check reporting `pending`, or one that already answered "still loading"
 *   for its current registration → waits for the card to re-register;
 * - a check that refuses → rejects with {@link BeforeApproveRefusedError};
 * - nothing approvable within `timeoutMs` → rejects with {@link BeforeApproveTimeoutError}.
 */
export const runBeforeApproveWhenReady = (
  messageId: string,
  {
    settleMs = BEFORE_APPROVE_SETTLE_MS,
    signal,
    timeoutMs = BEFORE_APPROVE_TIMEOUT_MS,
  }: RunBeforeApproveWhenReadyOptions = {},
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let finished = false;
    let probing = false;
    let scheduled = false;
    let answeredLoadingAt = -1;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = () => {
      finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };

    function finish(error?: unknown) {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(settleTimer);
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      if (error === undefined) resolve();
      else reject(error);
    }

    async function probe(version: number) {
      probing = true;
      try {
        await runBeforeApproveChecks(messageId);
        finish();
      } catch (error) {
        if (isBeforeApprovePendingError(error)) answeredLoadingAt = version;
        else finish(new BeforeApproveRefusedError(error));
      } finally {
        probing = false;
        if (!finished) evaluate();
      }
    }

    function evaluate() {
      if (finished || probing) return;
      clearTimeout(settleTimer);
      settleTimer = undefined;

      const snapshot = getBeforeApproveSnapshot(messageId);
      // Its tab is not open (yet).
      if (!snapshot.mounted) return;
      if (snapshot.checkCount === 0) {
        finish();
        return;
      }
      if (snapshot.pending) return;
      // This exact registration already said "still loading": wait for the card to re-register.
      if (snapshot.version === answeredLoadingAt) return;
      if (!snapshot.changedSinceMount && snapshot.quietFor < settleMs) {
        settleTimer = setTimeout(evaluate, settleMs - snapshot.quietFor);
        return;
      }

      void probe(snapshot.version);
    }

    // A card changing state re-registers as "cleanup, then register" inside one
    // React commit; judging in between would see a mounted card without checks
    // and approve around it. Look once the commit is done.
    function scheduleEvaluate() {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        evaluate();
      });
    }

    // Nothing is set up yet, so reject directly: `finish` reads `deadline` and
    // `unsubscribe`, which are only initialised below.
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }

    signal?.addEventListener('abort', onAbort);
    const deadline = setTimeout(() => finish(new BeforeApproveTimeoutError(messageId)), timeoutMs);
    const unsubscribe = subscribeBeforeApprove(scheduleEvaluate);
    scheduleEvaluate();
  });
