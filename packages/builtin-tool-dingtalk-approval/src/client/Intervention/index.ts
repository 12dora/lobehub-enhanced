import type { BuiltinIntervention } from '@lobechat/types';

import { DINGTALK_APPROVAL_WRITE_APIS } from '../apiNames';
import Confirm from './Confirm';

/**
 * Intervention registry: every write API of the lobe-dingtalk-approval toolset
 * is confirmed through the same preview-driven card (shared contract §4.2 —
 * writes are `humanIntervention: 'always'` and never bypassable).
 */
export const DingtalkApprovalInterventions: Record<string, BuiltinIntervention> =
  Object.fromEntries(
    DINGTALK_APPROVAL_WRITE_APIS.map((apiName) => [apiName, Confirm as BuiltinIntervention]),
  );

export { default as DingtalkApprovalConfirm } from './Confirm';
