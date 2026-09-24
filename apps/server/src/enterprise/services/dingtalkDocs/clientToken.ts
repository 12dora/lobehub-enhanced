import { createHash, randomUUID } from 'node:crypto';

/** Stable prefix so a tool-call retry hashes to the same DingTalk client token. */
export const AITABLE_CREATE_TOKEN_PREFIX = 'lobe-dingtalk-docs:createAitableRecords:';

/**
 * UUID v4 derived from sha256(prefix + toolCallId).
 * Version nibble is forced to 4 and the variant bits to 10xx.
 */
export const aitableCreateClientToken = (toolCallId: string): string => {
  const digest = createHash('sha256')
    .update(`${AITABLE_CREATE_TOKEN_PREFIX}${toolCallId}`)
    .digest();
  const bytes = [...digest.subarray(0, 16)];
  const version = bytes[6] ?? 0;
  const variant = bytes[8] ?? 0;
  bytes[6] = (version & 0x0f) | 0x40;
  bytes[8] = (variant & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Same tool call id always returns the same token. A missing id gets a fresh UUID. */
export const resolveAitableCreateClientToken = (toolCallId: string | undefined): string => {
  if (typeof toolCallId !== 'string' || toolCallId.trim() === '') return randomUUID();
  return aitableCreateClientToken(toolCallId);
};
