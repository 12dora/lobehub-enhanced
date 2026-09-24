export interface BotPlatformInfo {
  /** Absolute AIHub origin (`APP_URL`). Markdown platforms are told to link pages with it. */
  appUrl?: string;
  platformName: string;
  supportsMarkdown: boolean;
  /** Non-fatal warnings from message processing (e.g. file too large, parse failure) */
  warnings?: string[];
}

/** Escape HTML/XML-significant characters to keep prompt injection vectors closed. */
const sanitizePromptText = (text: string) =>
  text.replaceAll(
    /[<>&"']/g,
    (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

/**
 * Format bot platform context into a system-level instruction.
 *
 * Always tells the AI which platform it's running on so it can adapt its behavior.
 * When the platform does not support Markdown, instructs the AI to use plain text only.
 */
export const formatBotPlatformContext = ({
  appUrl,
  platformName,
  supportsMarkdown,
  warnings,
}: BotPlatformInfo): string => {
  const safePlatformName = sanitizePromptText(platformName);
  // DingTalk robots cannot read group history. The generic readMessages
  // instruction makes the model call a tool that always fails. Match the
  // platform id and the registry display name ("DingTalk").
  const historyIsReadable = platformName.trim().toLowerCase() !== 'dingtalk';
  const behavior = [
    '- Act like a knowledgeable group member: respond naturally, stay on topic, and match the conversational tone.',
  ];
  if (historyIsReadable) {
    behavior.push(
      '- When the user\'s message references prior context you don\'t have (e.g. "what do you think?", "summarize this", "look at that"), use `readMessages` IMMEDIATELY to fetch recent chat history before responding. Never ask the user to repeat what was already said in the channel.',
    );
  }
  behavior.push(
    '- When you lack enough context to give a useful answer, silently read more history rather than asking clarifying questions — the answer is usually already in the chat.',
    '- Keep responses concise and conversational — IM platforms have character limits and small viewports. Avoid long preambles or formal structure unless the question demands it.',
    '- Do NOT reference UI elements from other environments (e.g. "check the sidebar", "click the button above").',
  );
  const lines = [
    `<bot_platform_context platform="${safePlatformName}">`,
    `You are a participant in a **${safePlatformName}** conversation — not an external assistant being consulted.`,
    '',
    '<behavior>',
    ...behavior,
    '</behavior>',
    '',
    '<message_delivery>',
    'Your text response is AUTOMATICALLY delivered to the current conversation — the runtime pipeline handles it.',
    'Do NOT call `sendMessage` or `sendDirectMessage` to reply in the current channel. Just respond with text directly.',
    '`sendMessage` / `sendDirectMessage` should ONLY be used when the user explicitly asks you to send a message to a DIFFERENT channel or user.',
    '</message_delivery>',
  ];

  const safeAppUrl = sanitizePromptText((appUrl ?? '').trim().replace(/\/+$/, ''));
  if (supportsMarkdown && safeAppUrl) {
    const isDingTalk = platformName.trim().toLowerCase() === 'dingtalk';
    lines.push(
      '',
      '<app_links>',
      `The AIHub web app is at ${safeAppUrl}.`,
      `When you mention a page the user must open in AIHub, give a full clickable markdown link that starts with ${safeAppUrl}. Do not write only a menu path.`,
      ...(isDingTalk
        ? [
            `Inside DingTalk, wrap that link as ${safeAppUrl}/dingtalk/sso?redirect=<urlencoded app path> so the in-app browser signs the user in.`,
          ]
        : []),
      '</app_links>',
    );
  }

  if (!supportsMarkdown) {
    lines.push(
      '',
      '<formatting>',
      'This platform does NOT support Markdown rendering.',
      'You MUST NOT use any Markdown formatting in your response, including:',
      '- **bold**, *italic*, ~~strikethrough~~',
      '- `inline code` or ```code blocks```',
      '- # Headings',
      '- [links](url)',
      '- Tables, blockquotes, or HTML tags',
      '',
      'Use plain text only. Use line breaks, indentation, dashes, and numbering to structure your response for readability.',
      '</formatting>',
    );
  }

  if (warnings && warnings.length > 0) {
    // Sanitize warning text to prevent prompt injection via user-controlled content
    // (e.g. filenames containing XML tags or special characters)
    lines.push(
      '',
      '<processing_warnings>',
      "The following issues occurred while processing the user's message.",
      'Briefly inform the user about these issues in your response:',
      ...warnings.map((w) => `- ${sanitizePromptText(w)}`),
      '</processing_warnings>',
    );
  }

  lines.push('</bot_platform_context>');

  return lines.join('\n');
};
