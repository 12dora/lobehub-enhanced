import { useTranslation } from 'react-i18next';

import type { MaskIdentifiersOptions } from '../components/displayText';

/**
 * Neutral nouns for everything a payload left unnamed. A row that cannot name what
 * it is showing says 「未命名日程」 — an identifier in that slot would only look like
 * a name to the system that issued it.
 */
export const useUnnamedText = () => {
  const { t } = useTranslation('plugin');
  const department = t('builtins.lobe-dingtalk-workspace.ui.render.unnamed.department');
  const person = t('builtins.lobe-dingtalk-workspace.ui.render.unnamed.person');

  return {
    department,
    event: t('builtins.lobe-dingtalk-workspace.ui.render.unnamed.event'),
    /** Stands in for a confirm-card value that was only an internal identifier. */
    item: t('builtins.lobe-dingtalk-workspace.ui.render.unnamed.item'),
    /** Nouns substituted for `staff:` / `dept:` tokens found inside free text. */
    mask: { department, person } satisfies MaskIdentifiersOptions,
    person,
    room: t('builtins.lobe-dingtalk-workspace.ui.render.unnamed.room'),
    todo: t('builtins.lobe-dingtalk-workspace.ui.render.unnamed.todo'),
  };
};
