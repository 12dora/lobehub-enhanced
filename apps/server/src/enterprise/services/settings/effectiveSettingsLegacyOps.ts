import isEqual from 'fast-deep-equal';

import { MANAGED_ERROR_CODES } from '@/const/platform/errorCodes';

import { SettingsPathError } from './effectiveSettingsErrors';
import { flattenLeaves } from './pathUtils';
import { settingsRegistry } from './registry';

export function collectLegacyOverrideOps(
  validatedInput: Record<string, unknown>,
): Array<{ path: string; value: unknown }> {
  const leaves = flattenLeaves(validatedInput).filter((l) => !l.path.startsWith('keyVaults'));
  const ops: Array<{ path: string; value: unknown }> = [];

  for (const leaf of leaves) {
    const { path, value } = leaf;
    if (settingsRegistry.isSecretPath(path)) {
      throw new SettingsPathError(
        MANAGED_ERROR_CODES.MANAGED_SETTING_SECRET_PATH,
        `Secret path not allowed: ${path}`,
      );
    }
    if (!settingsRegistry.has(path)) {
      // known catalog leaf not in platform registry → stays in legacy partial
      continue;
    }
    // Legacy updateSettings is a user-facing client API (web/desktop/mobile)
    const gate = settingsRegistry.assertPathWritable({ client: 'web', path });
    if (gate) throw new SettingsPathError(gate);

    const validated = settingsRegistry.validateValue(path, value);
    if (!validated.ok) {
      throw new SettingsPathError(
        MANAGED_ERROR_CODES.MANAGED_SETTING_INVALID_VALUE,
        validated.message,
      );
    }
    ops.push({ path, value: validated.value });
  }

  return ops;
}

/**
 * Wholesale legacy updates echo the whole effective blob, including locked
 * registry leaves the user did not change. Those ops are no-ops and must be
 * dropped before the lock check; a different value is still forbidden.
 *
 * `lockedEffectiveValues` is keyed by path and must only contain currently
 * locked leaves (mode=locked). Unregistered skill-list fields never appear here.
 */
export function dropNoopLockedLegacyOps(
  ops: Array<{ path: string; value: unknown }>,
  lockedEffectiveValues: ReadonlyMap<string, unknown>,
): Array<{ path: string; value: unknown }> {
  const writable: Array<{ path: string; value: unknown }> = [];

  for (const op of ops) {
    if (!lockedEffectiveValues.has(op.path)) {
      writable.push(op);
      continue;
    }
    if (isEqual(op.value, lockedEffectiveValues.get(op.path))) continue;
    throw new SettingsPathError(MANAGED_ERROR_CODES.MANAGED_SETTING_BY_ADMIN);
  }

  return writable;
}
