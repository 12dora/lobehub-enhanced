import type { BuiltinIntervention } from '@lobechat/types';

import { DingtalkPersonalWriteApiNames } from '../apiNames';
import Confirm from './Confirm';

/**
 * Intervention registry: every write API of the lobe-dingtalk-personal toolset
 * is `humanIntervention: 'always'` and confirmed through the same preview card.
 */
export const DingtalkPersonalInterventions: Record<string, BuiltinIntervention> =
  Object.fromEntries(
    DingtalkPersonalWriteApiNames.map((apiName) => [apiName, Confirm as BuiltinIntervention]),
  );

export { default as DingtalkPersonalConfirm } from './Confirm';
