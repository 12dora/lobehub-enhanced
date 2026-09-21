import { DingtalkApprovalWriteApiName } from '../types';

/**
 * API-name seam for the client surfaces: the canonical enums live in
 * `../types`, the UI only adds the danger list that styles the confirm card.
 */
export type { DingtalkApprovalApiNameType, DingtalkApprovalWriteApiNameType } from '../types';
export { DINGTALK_APPROVAL_WRITE_APIS, DingtalkApprovalApiName } from '../types';

/**
 * Local fallback for the accent of the confirm card: `preview.danger` from the
 * server wins, this list only covers a preview that omits the flag.
 */
export const DINGTALK_APPROVAL_DANGER_API_NAMES = new Set<string>([
  DingtalkApprovalWriteApiName.refuseTask,
  DingtalkApprovalWriteApiName.returnTask,
  DingtalkApprovalWriteApiName.withdrawApplication,
  DingtalkApprovalWriteApiName.deleteTemplate,
  DingtalkApprovalWriteApiName.deleteApprovalRule,
]);
