/**
 * Maps builtin server-runtime tool identifiers to the platform module that owns
 * them. Unlisted identifiers are core and always allowed.
 *
 * The map is derived from `PlatformModuleDefinition.toolIdentifiers` so a new
 * module gate is one catalog row, not a second hand-written table.
 */
import type { PlatformModuleId } from '@/const/platform/modules';
import { PLATFORM_MODULE_IDS, PLATFORM_MODULES } from '@/const/platform/modules';

import { assertModuleEnabled } from '../services/moduleSettings';

export const TOOL_MODULE_BY_IDENTIFIER: Readonly<Record<string, PlatformModuleId>> = Object.freeze(
  Object.fromEntries(
    PLATFORM_MODULE_IDS.flatMap((id) =>
      (PLATFORM_MODULES[id].toolIdentifiers ?? []).map((identifier) => [identifier, id]),
    ),
  ),
);

export const assertToolModuleEnabled = async (identifier: string): Promise<void> => {
  const moduleId = TOOL_MODULE_BY_IDENTIFIER[identifier];
  if (!moduleId) return;
  await assertModuleEnabled(moduleId);
};
