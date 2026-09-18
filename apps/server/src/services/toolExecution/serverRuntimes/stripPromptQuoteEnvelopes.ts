/**
 * Remove quote / speaker envelopes that `formatPrompt` prepends to persisted
 * IM user messages. Matching must use the user's own wording, not quoted text.
 */
export const stripPromptQuoteEnvelopes = (text: string): string =>
  text
    .replaceAll(/<referenced_message\b[^>]*>[\s\S]*?<\/referenced_message>/gi, '')
    .replaceAll(/<speaker\b[^>]*\/>/gi, '')
    .trim();
