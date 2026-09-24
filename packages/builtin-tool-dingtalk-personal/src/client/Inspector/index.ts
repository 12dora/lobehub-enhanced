import type { BuiltinInspector } from '@lobechat/types';

import { DingtalkPersonalApiName } from '../apiNames';
import Summary from './Summary';

/**
 * Inspector registry: every API renders the same one-line summary
 * 「<领域> · <动作>」.
 */
export const DingtalkPersonalInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(DingtalkPersonalApiName).map((apiName) => [apiName, Summary as BuiltinInspector]),
);

export { argHint } from './argHint';
export { default as DingtalkPersonalSummaryInspector } from './Summary';
