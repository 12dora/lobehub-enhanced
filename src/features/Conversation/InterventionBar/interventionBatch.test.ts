import { describe, expect, it, vi } from 'vitest';

import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import { getInterventionBatch, isBatchDecidable } from './interventionBatch';

// The real module pulls marketplace / topic services in; only the predicate matters.
vi.mock('../Messages/AssistantGroup/Tool/Detail/Intervention/customInteractionHandlers', () => ({
  isCustomInteractionIdentifier: (identifier: string) => identifier === 'lobe-user-interaction',
}));

const pending = (
  toolMessageId: string,
  overrides: Partial<PendingIntervention> = {},
): PendingIntervention => ({
  apiName: 'completeTodo',
  assistantGroupId: 'group-2',
  identifier: 'lobe-dingtalk-personal',
  intervention: { kind: 'approval', status: 'pending' },
  requestArgs: '{}',
  toolCallId: `call_${toolMessageId}`,
  toolMessageId,
  ...overrides,
});

/** Tool message id → the assistant message that emitted it. */
const turnOf =
  (parents: Record<string, string | undefined>) =>
  (item: PendingIntervention): string | undefined =>
    parents[item.toolMessageId];

describe('isBatchDecidable', () => {
  it('accepts approval calls', () => {
    expect(isBatchDecidable(pending('t1'))).toBe(true);
    // Legacy rows carry no kind.
    expect(isBatchDecidable(pending('t1', { intervention: { status: 'pending' } }))).toBe(true);
  });

  it('leaves calls whose args hit the security blacklist to be decided one by one', () => {
    // Same verdict as the card's red warning (`rm -rf /` → rmRootDir).
    const dangerous = pending('t1', {
      apiName: 'runCommand',
      identifier: 'lobe-local-system',
      requestArgs: JSON.stringify({ command: 'rm -rf /' }),
    });
    const harmless = pending('t2', {
      apiName: 'runCommand',
      identifier: 'lobe-local-system',
      requestArgs: JSON.stringify({ command: 'ls -la' }),
    });

    expect(isBatchDecidable(dangerous)).toBe(false);
    expect(isBatchDecidable(harmless)).toBe(true);
    expect(
      getInterventionBatch([dangerous, harmless, pending('t3')], 1, () => 'asst-1').map(
        (i) => i.toolMessageId,
      ),
    ).toEqual(['t2', 't3']);
  });

  it('rejects human-answer interactions', () => {
    expect(
      isBatchDecidable(pending('t1', { intervention: { kind: 'toolResult', status: 'pending' } })),
    ).toBe(false);
    expect(
      isBatchDecidable(
        pending('t1', { apiName: 'askUserQuestion', identifier: 'lobe-user-interaction' }),
      ),
    ).toBe(false);
  });
});

describe('getInterventionBatch', () => {
  it('keeps the approve / reject calls of the active tab’s assistant message, in order', () => {
    const interventions = [
      pending('old'),
      pending('t1'),
      pending('ask', { apiName: 'askUserQuestion', identifier: 'lobe-user-interaction' }),
      pending('t2', { apiName: 'deleteTodo', identifier: 'lobe-dingtalk-workspace' }),
    ];
    const getTurnId = turnOf({ ask: 'asst-2', old: 'asst-1', t1: 'asst-2', t2: 'asst-2' });

    expect(getInterventionBatch(interventions, 1, getTurnId).map((i) => i.toolMessageId)).toEqual([
      't1',
      't2',
    ]);
    // A stale row of an older turn stands alone.
    expect(getInterventionBatch(interventions, 0, getTurnId).map((i) => i.toolMessageId)).toEqual([
      'old',
    ]);
  });

  it('never merges standalone rows of different turns', () => {
    // Standalone tool rows carry no assistantGroupId at all.
    const interventions = [
      pending('a1', { assistantGroupId: undefined }),
      pending('b1', { assistantGroupId: undefined }),
      pending('b2', { assistantGroupId: undefined }),
    ];
    const getTurnId = turnOf({ a1: 'asst-a', b1: 'asst-b', b2: 'asst-b' });

    expect(getInterventionBatch(interventions, 0, getTurnId).map((i) => i.toolMessageId)).toEqual([
      'a1',
    ]);
    expect(getInterventionBatch(interventions, 2, getTurnId).map((i) => i.toolMessageId)).toEqual([
      'b1',
      'b2',
    ]);
  });

  it('skips calls whose assistant message is unknown', () => {
    const interventions = [pending('t1'), pending('t2'), pending('orphan')];
    const getTurnId = turnOf({ orphan: undefined, t1: 'asst-1', t2: 'asst-1' });

    expect(getInterventionBatch(interventions, 0, getTurnId)).toHaveLength(2);
    expect(getInterventionBatch(interventions, 2, getTurnId)).toEqual([]);
  });

  it('anchors on the first call when the index is out of range', () => {
    const getTurnId = turnOf({ t1: 'asst-1', t2: 'asst-1' });

    expect(getInterventionBatch([pending('t1'), pending('t2')], 5, getTurnId)).toHaveLength(2);
    expect(getInterventionBatch([], 0, getTurnId)).toEqual([]);
  });
});
