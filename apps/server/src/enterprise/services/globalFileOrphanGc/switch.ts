const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off']);

/**
 * `GLOBAL_FILE_ORPHAN_GC` disables enqueue, the scheduler, worker-health
 * expectation, and a claimed sweep. Unset (and any other value) means enabled.
 * `0`, `false`, `no`, and `off` match in any case, with surrounding space ignored.
 */
export const isGlobalFileOrphanGcDisabled = (value: string | undefined): boolean => {
  if (value === undefined) return false;
  return DISABLED_VALUES.has(value.trim().toLowerCase());
};
