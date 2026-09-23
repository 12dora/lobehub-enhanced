/** Same marker the DingTalk bridge prepends after a title is generated. */
const DINGTALK_TOPIC_PREFIX = /^钉钉\s*·\s*/;

export const FALLBACK_TOPIC_TITLE_MAX_CHARS = 20;

/**
 * Local title when the topic model cannot run: first user message, DingTalk
 * prefix removed, clipped to 20 characters. Callers add the channel prefix.
 */
export const fallbackTopicTitle = (userPrompt: string | null | undefined): string | null => {
  const flattened = (userPrompt ?? '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(DINGTALK_TOPIC_PREFIX, '')
    .trim();
  if (!flattened) return null;
  return Array.from(flattened).slice(0, FALLBACK_TOPIC_TITLE_MAX_CHARS).join('');
};
