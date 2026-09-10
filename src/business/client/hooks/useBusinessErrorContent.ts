import { type ChatMessageError } from '@lobechat/types';

export interface BusinessErrorContentResult {
  errorType?: string;
  hideMessage?: boolean;
  /** Optional override message (e.g. cloud-formatted empty-completion cost). */
  message?: string;
}

export default function useBusinessErrorContent(
  // Takes the whole error, not just its type: business builds format the message from
  // `body`/`diagnostics` (empty-completion cost, for instance), which the type alone cannot carry.
  // eslint-disable-next-line unused-imports/no-unused-vars
  error?: ChatMessageError | null,
): BusinessErrorContentResult {
  return {};
}
