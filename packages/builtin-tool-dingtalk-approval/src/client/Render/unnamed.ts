import { useTranslation } from 'react-i18next';

import type { MaskIdentifiersOptions } from '../components/displayText';

/**
 * Neutral nouns for everything a payload left unnamed. A card that cannot name
 * what it is showing says 「未命名条目」 — an identifier in that slot would only
 * look like a name to the system that issued it.
 */
export const useUnnamedText = () => {
  const { t } = useTranslation('plugin');
  const department = t('builtins.lobe-dingtalk-approval.ui.render.unnamed.department');
  const person = t('builtins.lobe-dingtalk-approval.ui.render.unnamed.person');

  return {
    /** Row or card title for an entry that carries no readable name. */
    item: t('builtins.lobe-dingtalk-approval.ui.render.unnamed.item'),
    /** Nouns substituted for `staff:` / `dept:` tokens found inside free text. */
    mask: { department, person } satisfies MaskIdentifiersOptions,
  };
};
