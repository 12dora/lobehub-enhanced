import { describe, expect, it } from 'vitest';

import { batchItemCount, resolveBatchCall } from './batchCount';

describe('batchItemCount', () => {
  it('counts the todo ids of both batch APIs', () => {
    expect(batchItemCount('completeTodos', { taskIds: ['t1', 't2', 't3'] })).toBe(3);
    expect(batchItemCount('deleteTodos', { taskIds: ['t1'] })).toBe(1);
  });

  it('skips blanks and junk', () => {
    const taskIds = ['t1', '', '  ', null, {}, 42];

    expect(batchItemCount('deleteTodos', { taskIds })).toBe(2);
  });

  it('says nothing before the list has streamed in', () => {
    expect(batchItemCount('completeTodos')).toBeUndefined();
    expect(batchItemCount('completeTodos', {})).toBeUndefined();
    expect(batchItemCount('completeTodos', { taskIds: [] })).toBeUndefined();
    expect(batchItemCount('deleteTodos', { taskIds: 't1' })).toBeUndefined();
  });

  it('ignores single-item APIs', () => {
    expect(batchItemCount('deleteTodo', { taskIds: ['t1'] })).toBeUndefined();
    expect(batchItemCount('listTodos', { taskIds: ['t1'] })).toBeUndefined();
  });
});

describe('resolveBatchCall', () => {
  it('prefers the final arguments and counts partial ones while streaming', () => {
    const streamed = { taskIds: ['t1'] };

    expect(resolveBatchCall('deleteTodos', { taskIds: ['t1', 't2'] }, streamed)).toEqual({
      apiName: 'deleteTodos',
      count: 2,
    });
    expect(resolveBatchCall('completeTodos', {}, { taskIds: ['t1', 't2', 't3'] })).toEqual({
      apiName: 'completeTodos',
      count: 3,
    });
  });

  it('is undefined for anything else', () => {
    expect(resolveBatchCall('completeTodos', {}, {})).toBeUndefined();
    expect(resolveBatchCall('completeTodo', { taskId: 't1' })).toBeUndefined();
  });
});
