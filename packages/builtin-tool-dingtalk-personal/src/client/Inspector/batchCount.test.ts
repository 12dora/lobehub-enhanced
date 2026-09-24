import { describe, expect, it } from 'vitest';

import { batchItemCount, resolveBatchCall } from './batchCount';

describe('batchItemCount', () => {
  it('counts the todo ids of a batch call', () => {
    expect(batchItemCount('completeTodos', { taskIds: ['1001', '1002', '1003'] })).toBe(3);
  });

  it('counts a numeric id and skips blanks and junk', () => {
    const taskIds = [57_475_254_077, ' ', null, {}, '1002'];

    expect(batchItemCount('completeTodos', { taskIds })).toBe(2);
  });

  it('says nothing before the list has streamed in', () => {
    expect(batchItemCount('completeTodos')).toBeUndefined();
    expect(batchItemCount('completeTodos', {})).toBeUndefined();
    expect(batchItemCount('completeTodos', { taskIds: [] })).toBeUndefined();
    expect(batchItemCount('completeTodos', { taskIds: '1001' })).toBeUndefined();
    expect(batchItemCount('completeTodos', 'not an object')).toBeUndefined();
  });

  it('ignores single-item APIs', () => {
    expect(batchItemCount('completeTodo', { taskIds: ['1001'] })).toBeUndefined();
    expect(batchItemCount('listMyTodos', { taskIds: ['1001'] })).toBeUndefined();
  });
});

describe('resolveBatchCall', () => {
  it('prefers the final arguments', () => {
    expect(resolveBatchCall('completeTodos', { taskIds: ['1', '2'] }, { taskIds: ['1'] })).toEqual({
      apiName: 'completeTodos',
      count: 2,
    });
  });

  it('counts the partial arguments while they stream', () => {
    expect(resolveBatchCall('completeTodos', {}, { taskIds: ['1', '2', '3'] })).toEqual({
      apiName: 'completeTodos',
      count: 3,
    });
    expect(resolveBatchCall('completeTodos', undefined, { taskIds: ['1'] })).toEqual({
      apiName: 'completeTodos',
      count: 1,
    });
  });

  it('is undefined for anything else', () => {
    expect(resolveBatchCall('completeTodos', {}, {})).toBeUndefined();
    expect(resolveBatchCall('completeTodo', { taskId: '1' })).toBeUndefined();
  });
});
