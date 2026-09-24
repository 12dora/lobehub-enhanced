import type { AiProviderModelListItem } from 'model-bank';

type NestedKey = 'abilities' | 'config' | 'settings';

const NESTED_KEYS: readonly NestedKey[] = ['abilities', 'config', 'settings'];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The payload the model-config modal saves.
 *
 * `form.getFieldsValue()` only returns the fields the form renders, and a save REPLACES the
 * stored `abilities` / `config` / `settings` objects (user and admin paths alike). Sent as is,
 * every key the form does not show would be wiped — e.g. a collapsed Cursor model's
 * `settings.effortLevels` / `defaultEffortLevel`, `settings.searchImpl`, or `abilities.files` —
 * until the next upstream sync. So each of those objects is merged over the stored one: the
 * edited keys win, everything else is kept.
 */
export const mergeModelConfigValues = <T extends Partial<AiProviderModelListItem>>(
  stored: Partial<AiProviderModelListItem> | undefined,
  values: T,
): T => {
  if (!stored) return values;

  const merged: Record<string, unknown> = { ...values };

  for (const key of NESTED_KEYS) {
    const edited = values[key];
    const current = stored[key];
    if (!isPlainObject(edited) || !isPlainObject(current)) continue;

    merged[key] = { ...current, ...edited };
  }

  return merged as T;
};
