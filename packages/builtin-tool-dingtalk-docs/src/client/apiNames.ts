import { DingtalkDocsApiName, DingtalkDocsWriteApiNames } from '../types';

/**
 * API-name seam for the client surfaces: the canonical enums live in
 * `../types`, the UI only adds the guards the cards need.
 */
export { DingtalkDocsApiName, DingtalkDocsWriteApiNames } from '../types';

export type DingtalkDocsApiNameValue =
  (typeof DingtalkDocsApiName)[keyof typeof DingtalkDocsApiName];

export type DingtalkDocsWriteApiNameValue = (typeof DingtalkDocsWriteApiNames)[number];

const API_NAMES = new Set<string>(Object.values(DingtalkDocsApiName));

const WRITE_API_NAMES = new Set<string>(DingtalkDocsWriteApiNames);

export const isDingtalkDocsApiName = (apiName: unknown): apiName is DingtalkDocsApiNameValue =>
  typeof apiName === 'string' && API_NAMES.has(apiName);

/** Writes are `humanIntervention: 'always'` and go through the confirm card. */
export const isDingtalkDocsWriteApiName = (
  apiName: unknown,
): apiName is DingtalkDocsWriteApiNameValue =>
  typeof apiName === 'string' && WRITE_API_NAMES.has(apiName);
