import isEqual from 'fast-deep-equal';
import { useTranslation } from 'react-i18next';

import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

/**
 * Looks a `plugin` namespace key up and returns its translation, or `undefined`
 * when the key has no translation in any loaded language.
 */
export type PluginTranslate = (key: string) => string | undefined;

export interface InterventionLabelInput {
  apiName: string;
  identifier: string;
  /** Tool title from the installed manifest meta (plugins / MCP / skills). */
  metaTitle?: string;
  translate: PluginTranslate;
}

const pickText = (value?: string) => (value && value.trim() ? value.trim() : undefined);

/**
 * Human label for a pending tool call, e.g. 「完成待办」 instead of `completeTodo`.
 *
 * Same key ToolTitle uses for the call chrome (`plugin` namespace
 * `builtins.<identifier>.apiName.<apiName>`), but checked for existence first so a
 * missing translation falls back to the tool's title instead of the raw API name:
 *
 * 1. translated API label
 * 2. `<tool title> · <apiName>` — the tool title (translated builtin title, else the
 *    manifest meta title) keeps sibling tabs of one tool apart
 * 3. `apiName`
 */
export const resolveInterventionLabel = ({
  apiName,
  identifier,
  metaTitle,
  translate,
}: InterventionLabelInput): string => {
  const apiLabel = pickText(translate(`builtins.${identifier}.apiName.${apiName}`));
  if (apiLabel) return apiLabel;

  const toolTitle = pickText(translate(`builtins.${identifier}.title`)) ?? pickText(metaTitle);
  if (toolTitle) return apiName ? `${toolTitle} · ${apiName}` : toolTitle;

  return apiName || identifier;
};

/**
 * Localized label of a pending tool call (see {@link resolveInterventionLabel}).
 */
export const useInterventionLabel = (identifier: string, apiName: string): string => {
  const { t, i18n } = useTranslation('plugin');
  const pluginMeta = useToolStore(toolSelectors.getMetaById(identifier), isEqual);

  return resolveInterventionLabel({
    apiName,
    identifier,
    metaTitle: pluginHelpers.getPluginTitle(pluginMeta),
    translate: (key) => (i18n.exists(key, { ns: 'plugin' }) ? String(t(key as never)) : undefined),
  });
};
