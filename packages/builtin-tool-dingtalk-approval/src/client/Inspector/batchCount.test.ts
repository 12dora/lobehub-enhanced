import { describe, expect, it } from 'vitest';

import { batchItemCount, resolveBatchCall } from './batchCount';

const task = (index: number) => ({
  processInstanceId: `pi-${index}`,
  taskId: `20491830917${index}`,
});

describe('batchItemCount', () => {
  it('counts the approvals of both batch APIs', () => {
    expect(batchItemCount('approveTasks', { tasks: [task(1), task(2)] })).toBe(2);
    expect(batchItemCount('refuseTasks', { remark: '预算不足', tasks: [task(1)] })).toBe(1);
  });

  it('counts an entry only once it names something', () => {
    const tasks = [task(1), {}, { taskId: '  ' }, { processInstanceId: 'pi-2' }, null, 'pi-3', []];

    expect(batchItemCount('approveTasks', { tasks })).toBe(2);
  });

  it('says nothing before the list has streamed in', () => {
    expect(batchItemCount('approveTasks')).toBeUndefined();
    expect(batchItemCount('approveTasks', {})).toBeUndefined();
    expect(batchItemCount('approveTasks', { tasks: [] })).toBeUndefined();
    expect(batchItemCount('approveTasks', { tasks: [{}] })).toBeUndefined();
    expect(batchItemCount('refuseTasks', { tasks: task(1) })).toBeUndefined();
  });

  it('ignores single-item APIs', () => {
    expect(batchItemCount('approveTask', { tasks: [task(1)] })).toBeUndefined();
    expect(batchItemCount('listPendingApprovals', { tasks: [task(1)] })).toBeUndefined();
  });
});

describe('resolveBatchCall', () => {
  it('prefers the final arguments and counts partial ones while streaming', () => {
    const streamed = { tasks: [task(1)] };

    expect(resolveBatchCall('approveTasks', { tasks: [task(1), task(2)] }, streamed)).toEqual({
      apiName: 'approveTasks',
      count: 2,
    });
    expect(resolveBatchCall('refuseTasks', {}, { tasks: [task(1), { taskId: '2' }] })).toEqual({
      apiName: 'refuseTasks',
      count: 2,
    });
  });

  it('is undefined for anything else', () => {
    expect(resolveBatchCall('approveTasks', {}, {})).toBeUndefined();
    const single = { processInstanceId: 'pi', taskId: '1' };

    expect(resolveBatchCall('approveTask', single)).toBeUndefined();
  });
});
