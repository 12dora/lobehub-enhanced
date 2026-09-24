import type { BuiltinIntervention } from '@lobechat/types';

import { DingtalkDocsWriteApiNames } from '../apiNames';
import Confirm from './Confirm';

/**
 * Intervention registry: every write API of the lobe-dingtalk-docs toolset is
 * `humanIntervention: 'always'` and confirmed through the same preview card.
 */
export const DingtalkDocsInterventions: Record<string, BuiltinIntervention> = Object.fromEntries(
  DingtalkDocsWriteApiNames.map((apiName) => [apiName, Confirm as BuiltinIntervention]),
);

export { default as DingtalkDocsConfirm } from './Confirm';
