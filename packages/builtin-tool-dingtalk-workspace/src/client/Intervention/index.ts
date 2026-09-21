import type { BuiltinIntervention } from '@lobechat/types';

import { DingtalkWorkspaceWriteApiNames } from '../apiNames';
import Confirm from './Confirm';

/**
 * Intervention registry: every write API of the lobe-dingtalk-workspace toolset
 * is confirmed through the same preview-driven card (shared contract §5 —
 * todo/calendar writes are `humanIntervention: 'always'`).
 */
export const DingtalkWorkspaceInterventions: Record<string, BuiltinIntervention> =
  Object.fromEntries(
    DingtalkWorkspaceWriteApiNames.map((apiName) => [apiName, Confirm as BuiltinIntervention]),
  );

export { default as DingtalkWorkspaceConfirm } from './Confirm';
