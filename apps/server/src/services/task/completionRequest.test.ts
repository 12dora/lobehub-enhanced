import { describe, expect, it } from 'vitest';

import {
  completionRequestMatches,
  isSelfCompletingRun,
  readCompletionRequest,
  recordedCompletionApplies,
} from './completionRequest';

describe('completionRequest', () => {
  it('reads a request only when it names an operation or topic', () => {
    expect(readCompletionRequest(null)).toBeUndefined();
    expect(readCompletionRequest({ completionRequest: { cleared: true } })).toBeUndefined();
    expect(
      readCompletionRequest({ completionRequest: { operationId: 'op-1', topicId: 'topic-1' } }),
    ).toEqual({ operationId: 'op-1', requestedAt: undefined, topicId: 'topic-1' });
  });

  it('matches the executing operation or topic', () => {
    const request = { operationId: 'op-1', topicId: 'topic-1' };
    expect(completionRequestMatches(request, { operationId: 'op-1' })).toBe(true);
    expect(completionRequestMatches(request, { topicId: 'topic-1' })).toBe(true);
    expect(completionRequestMatches(request, { operationId: 'op-other', topicId: 'other' })).toBe(
      false,
    );
  });

  it('treats the live task run as self-completion before a topic row exists', () => {
    expect(
      isSelfCompletingRun('task-1', [], {
        operationId: 'op-live',
        taskId: 'task-1',
        topicId: 'topic-live',
      }),
    ).toBe(true);
  });

  it('treats a matching running topic as self-completion', () => {
    expect(
      isSelfCompletingRun(
        'task-1',
        [{ operationId: 'op-live', status: 'running', topicId: 'topic-live' }],
        { operationId: 'op-live' },
      ),
    ).toBe(true);
  });

  it('applies a recorded completion only while that operation is still running', () => {
    const task = {
      context: { completionRequest: { operationId: 'op-1', topicId: 'topic-1' } },
      status: 'running',
    };
    expect(recordedCompletionApplies(task, { operationId: 'op-1', topicId: 'topic-1' })).toBe(true);
    expect(
      recordedCompletionApplies(
        { ...task, status: 'canceled' },
        { operationId: 'op-1', topicId: 'topic-1' },
      ),
    ).toBe(false);
    expect(
      recordedCompletionApplies(
        { ...task, status: 'paused' },
        { operationId: 'op-1', topicId: 'topic-1' },
      ),
    ).toBe(false);
    expect(
      recordedCompletionApplies(task, { operationId: 'op-other', topicId: 'topic-other' }),
    ).toBe(false);
    expect(recordedCompletionApplies(null, { operationId: 'op-1' })).toBe(false);
  });

  it('does not treat another run or a user call as self-completion', () => {
    const topics = [{ operationId: 'op-live', status: 'running', topicId: 'topic-live' }];
    expect(
      isSelfCompletingRun('task-1', topics, {
        operationId: 'op-other',
        taskId: 'task-other',
        topicId: 'topic-other',
      }),
    ).toBe(false);
    expect(isSelfCompletingRun('task-1', topics, {})).toBe(false);
  });
});
