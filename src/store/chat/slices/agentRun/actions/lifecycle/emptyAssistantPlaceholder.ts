import { LOADING_FLAT } from '@lobechat/const';
import type { UIChatMessage } from '@lobechat/types';

type PlaceholderCandidate = Pick<
  UIChatMessage,
  | 'audioList'
  | 'children'
  | 'chunksList'
  | 'content'
  | 'error'
  | 'fileList'
  | 'imageList'
  | 'reasoning'
  | 'role'
  | 'search'
  | 'tools'
>;

const hasItems = (list: unknown[] | null | undefined) => Array.isArray(list) && list.length > 0;

/**
 * An assistant row that is still nothing but the loading placeholder the
 * runtime creates before the first token (`LOADING_FLAT` / blank content) and
 * carries nothing else worth showing: no tool calls, reasoning, error,
 * attachments or search grounding.
 *
 * Once its run has ended such a row is not a reply — rendering it leaves a
 * permanent "..." bubble. It must never be confused with a row that holds tool
 * output or an error, both of which are the user-visible outcome of the turn.
 *
 * Render-only: the row itself is deliberately left in the store and the DB so
 * the parent chain stays linear (removing it would fork the next message into
 * a sibling branch).
 */
export const isEmptyAssistantPlaceholder = (message: PlaceholderCandidate | undefined): boolean => {
  if (!message || message.role !== 'assistant') return false;

  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (content && content !== LOADING_FLAT) return false;

  if (hasItems(message.tools)) return false;
  if (hasItems(message.children)) return false;
  if (message.error) return false;
  if (message.reasoning?.content?.trim()) return false;
  if (hasItems(message.imageList)) return false;
  if (hasItems(message.fileList)) return false;
  if (hasItems(message.audioList)) return false;
  if (hasItems(message.chunksList)) return false;
  if (message.search) return false;

  return true;
};
