import type { BuiltinInspector } from '@lobechat/types';

import { DingtalkDocsApiName } from '../apiNames';
import Summary from './Summary';

/** Inspector registry: every API renders the same one-line sentence summary. */
export const DingtalkDocsInspectors: Record<string, BuiltinInspector> = Object.fromEntries(
  Object.values(DingtalkDocsApiName).map((apiName) => [apiName, Summary as BuiltinInspector]),
);

export type { DocsCallSummary } from './describe';
export { describeDocsCall } from './describe';
export { default as DingtalkDocsSummaryInspector } from './Summary';
