import type { BuiltinInspector } from '@lobechat/types';

import { DingtalkApprovalApiName } from '../apiNames';
import Summary from './Summary';

/**
 * Inspector registry: every API renders the same one-line summary
 * 「钉钉审批 · <动作>」, so the conversation header stays scannable.
 */
export const DingtalkApprovalInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(DingtalkApprovalApiName).map((apiName) => [apiName, Summary as BuiltinInspector]),
);

export { argHint } from './argHint';
export { default as DingtalkApprovalSummaryInspector } from './Summary';
