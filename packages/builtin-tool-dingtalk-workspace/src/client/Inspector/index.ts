import type { BuiltinInspector } from '@lobechat/types';

import { DingtalkWorkspaceApiName } from '../apiNames';
import Summary from './Summary';

/**
 * Inspector registry: every API renders the same one-line summary
 * 「钉钉日程 · <动作>」/「钉钉待办 · <动作>」.
 */
export const DingtalkWorkspaceInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(DingtalkWorkspaceApiName).map((apiName) => [apiName, Summary as BuiltinInspector]),
);

export { argHint } from './argHint';
export { default as DingtalkWorkspaceSummaryInspector } from './Summary';
