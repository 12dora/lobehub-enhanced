/**
 * A completion the executing run asked for via updateTaskStatus(completed).
 * Stored on `tasks.context.completionRequest` until the run finishes and
 * onTopicComplete (through the result bridge) applies it. Kept out of the
 * shared TaskContext type so this fork can ship the pocket without a types
 * package change.
 */
export interface TaskCompletionRequest {
  operationId?: string;
  requestedAt?: string;
  topicId?: string;
}

export interface SelfCompletionSource {
  operationId?: string;
  /** Internal id of the task this operation is executing, when it is a task run. */
  taskId?: string;
  topicId?: string;
}

export interface RunningTopicRef {
  operationId?: string | null;
  status?: string | null;
  topicId?: string | null;
}

export const readCompletionRequest = (context: unknown): TaskCompletionRequest | undefined => {
  const raw = (context as { completionRequest?: TaskCompletionRequest | null } | null)
    ?.completionRequest;
  if (!raw || typeof raw !== 'object') return undefined;
  const operationId = typeof raw.operationId === 'string' ? raw.operationId : undefined;
  const topicId = typeof raw.topicId === 'string' ? raw.topicId : undefined;
  if (!operationId && !topicId) return undefined;
  return {
    operationId,
    requestedAt: typeof raw.requestedAt === 'string' ? raw.requestedAt : undefined,
    topicId,
  };
};

export const completionRequestMatches = (
  request: TaskCompletionRequest,
  source: { operationId?: string; topicId?: string },
): boolean => {
  if (source.operationId && request.operationId && source.operationId === request.operationId) {
    return true;
  }
  if (source.topicId && request.topicId && source.topicId === request.topicId) return true;
  return false;
};

/**
 * Apply a recorded self-completion only while the task is still running the
 * operation that asked for it. Cancel, pause, complete, or failure leaves a
 * non-running status; a queued done hook must not turn that into completed.
 */
export const recordedCompletionApplies = (
  task: { context?: unknown; status?: string | null } | null | undefined,
  source: { operationId?: string; topicId?: string },
): boolean => {
  if (task?.status !== 'running') return false;
  const request = readCompletionRequest(task.context);
  if (!request) return false;
  return completionRequestMatches(request, source);
};

/**
 * True when this status change is the executing run completing its own task.
 *
 * The task_topics row is written only after execAgent returns, so a live run
 * often has no topic row yet. The tool context still carries the operation id
 * and the task id that operation was started for — that pair is the same
 * signal the completion hook will see.
 */
export const isSelfCompletingRun = (
  taskId: string,
  topics: RunningTopicRef[],
  source: SelfCompletionSource,
): boolean => {
  if (!source.operationId && !source.topicId) return false;

  const matchesLiveTopic = topics.some(
    (topic) =>
      topic.status === 'running' &&
      ((!!source.operationId && topic.operationId === source.operationId) ||
        (!!source.topicId && topic.topicId === source.topicId)),
  );
  if (matchesLiveTopic) return true;

  return source.taskId === taskId && !!(source.operationId || source.topicId);
};
