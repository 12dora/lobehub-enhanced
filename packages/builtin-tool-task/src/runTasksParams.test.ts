import { describe, expect, it } from 'vitest';

import { TaskManifest } from './manifest';
import { systemPrompt } from './systemRole';
import { TaskApiName } from './types';

describe('runTasks runNow', () => {
  const api = TaskManifest.api.find((item) => item.name === TaskApiName.runTasks);

  it('is optional and only for an explicit run-now request', () => {
    expect(api?.parameters?.required).toEqual(['identifiers']);
    expect(api?.parameters?.properties?.runNow).toMatchObject({ type: 'boolean' });
    expect(String(api?.parameters?.properties?.runNow?.description)).toContain(
      'Only when the user explicitly asked to run now',
    );
  });

  it('tells the model to omit runNow unless the user asked to run now', () => {
    expect(systemPrompt).toContain(
      'Pass runNow=true only when the user explicitly asked to run now',
    );
    expect(systemPrompt).toContain('Do not call runTask or runTasks');
  });
});
