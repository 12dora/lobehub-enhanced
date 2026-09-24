import { describe, expect, it } from 'vitest';

import { ALL_MODULES_ENABLED } from '@/const/platform/modules';

import { adminModulesGetOutputSchema, adminModulesUpdateInputSchema } from './adminModules';

describe('adminModules contracts', () => {
  it('strips a retired chatgptWeb key from update input instead of rejecting it', () => {
    const parsed = adminModulesUpdateInputSchema.parse({
      expectedRevision: 0,
      // leftover operator / stored payload from the retired pseudo-module
      modules: { chatgptWeb: false } as Record<string, boolean>,
    });

    expect(parsed).toEqual({ expectedRevision: 0, modules: {} });
  });

  it('requires requested on the snapshot and rejects a snapshot that omits it', () => {
    const snapshot = {
      db: null,
      effective: ALL_MODULES_ENABLED,
      envDisabled: [],
      envDisabledBy: {},
      preset: 'full' as const,
      presetFromEnv: 'full' as const,
      requested: ALL_MODULES_ENABLED,
      revision: 0,
      setupCompletedAt: null,
    };
    const view = {
      instanceId: 'pinst_test',
      pendingRestart: [],
      restart: { supported: false },
      snapshot,
    };

    expect(adminModulesGetOutputSchema.safeParse(view).success).toBe(true);

    const { requested, ...withoutRequested } = snapshot;
    expect(requested).toEqual(ALL_MODULES_ENABLED);
    expect(
      adminModulesGetOutputSchema.safeParse({ ...view, snapshot: withoutRequested }).success,
    ).toBe(false);
  });
});
