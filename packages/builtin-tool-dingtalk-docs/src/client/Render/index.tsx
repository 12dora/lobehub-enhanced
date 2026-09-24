import type { BuiltinRender } from '@lobechat/types';

import { DingtalkDocsApiName } from '../apiNames';
import ResultRender from './ResultRender';

/**
 * Render registry: every API (reads and confirmed writes) maps to the same `kind`-driven result
 * view, which also shows the inline authorize widget when the call needs the member's DingTalk
 * authorization first.
 */
export const DingtalkDocsRenders: Record<string, BuiltinRender> = Object.fromEntries(
  Object.values(DingtalkDocsApiName).map((apiName) => [apiName, ResultRender as BuiltinRender]),
);

export type { DingtalkDocsRenderState } from './ResultRender';
export { default as DingtalkDocsResultRender } from './ResultRender';
