import type { BuiltinRender } from '@lobechat/types';

import { DINGTALK_APPROVAL_WRITE_APIS, DingtalkApprovalApiName } from '../apiNames';
import Detail from './Detail';
import ListResult from './ListResult';
import WriteResult from './WriteResult';

/**
 * Render registry: list APIs get a dense result list, detail APIs a label/value
 * card, and every write API a one-line success state (or the mapped error); a
 * batch write's state switches the same render to its per-approval list.
 */
export const DingtalkApprovalRenders: Record<string, BuiltinRender> = {
  [DingtalkApprovalApiName.getApprovalDetail]: Detail as BuiltinRender,
  [DingtalkApprovalApiName.getTemplateSchema]: Detail as BuiltinRender,
  [DingtalkApprovalApiName.listApprovalRules]: ListResult as BuiltinRender,
  [DingtalkApprovalApiName.listMyApplications]: ListResult as BuiltinRender,
  [DingtalkApprovalApiName.listPendingApprovals]: ListResult as BuiltinRender,
  [DingtalkApprovalApiName.listTemplates]: ListResult as BuiltinRender,
  [DingtalkApprovalApiName.searchDirectory]: ListResult as BuiltinRender,
  ...Object.fromEntries(
    DINGTALK_APPROVAL_WRITE_APIS.map((apiName) => [apiName, WriteResult as BuiltinRender]),
  ),
};

export { default as DingtalkApprovalBatchWriteRender } from './BatchWriteResult';
export { default as DingtalkApprovalDetailRender } from './Detail';
export { default as DingtalkApprovalListRender } from './ListResult';
export { default as DingtalkApprovalWriteRender } from './WriteResult';
