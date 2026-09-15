import { DEFAULT_INBOX_TITLE } from '@lobechat/const';

import { BUILTIN_AGENT_SLUGS } from '../../types';

/**
 * Inbox Agent System Role Template
 *
 * This is the default assistant agent for general conversations.
 * `{{assistantName}}` is replaced with the resolved inbox display name
 * (catalog → branding → DEFAULT_INBOX_TITLE). Never hard-code a product persona.
 */
const systemRoleTemplate = `You are {{assistantName}}, an AI Agent will help users.

Today's date: {{date}}

Your role is to:
- Answer questions accurately and helpfully
- Assist with a wide variety of tasks
- Provide clear and concise explanations
- Be friendly and professional in your responses

Respond in the same language the user is using.`;

const LANGUAGE_LINE_PREFIX = 'Preferred reply language: ';
const LANGUAGE_LINE_SUFFIX = '. Use this language unless the user explicitly asks to switch.';
const STOCK_INBOX_INTRO_RE = /^You are (.+), an AI Agent will help users\.$/u;

/**
 * BCP-47-ish locale tag as emitted by `createSystemRole` (`en-US`, `zh-CN`,
 * `ar`). Rejects spaces, extra sentences, or any other authored text.
 */
const LOCALE_TAG_RE = /^[A-Z]{2,3}(?:-[A-Z]{2,8})?$/i;

export interface CreateInboxSystemRoleOptions {
  assistantName?: string;
}

const preferredLanguageLine = (userLocale: string) =>
  `${LANGUAGE_LINE_PREFIX}${userLocale}${LANGUAGE_LINE_SUFFIX}`;

/** Drop trailing whitespace / newlines only — leading or inner edits stay. */
const normalizeTrailingWhitespace = (value: string) => value.replace(/\s+$/u, '');

const resolveInboxAssistantName = (assistantName?: string) =>
  assistantName?.trim() || DEFAULT_INBOX_TITLE;

const interpolateAssistantName = (assistantName: string) =>
  systemRoleTemplate.replaceAll('{{assistantName}}', () => assistantName);

/** First-line name from a stock inbox prompt, including the legacy "You are Lobe," body. */
const extractStockInboxAssistantName = (role: string): string | undefined => {
  const firstLine = role.split('\n', 1)[0] ?? '';
  const name = firstLine.match(STOCK_INBOX_INTRO_RE)?.[1]?.trim();
  return name || undefined;
};

export const createSystemRole = (userLocale?: string, options?: CreateInboxSystemRoleOptions) =>
  [
    interpolateAssistantName(resolveInboxAssistantName(options?.assistantName)),
    userLocale ? preferredLanguageLine(userLocale) : '',
  ]
    .filter(Boolean)
    .join('\n\n');

export const isInboxAgentSlug = (slug?: string | null): boolean =>
  slug === BUILTIN_AGENT_SLUGS.inbox;

/**
 * True when `systemRole` is exactly a stock inbox prompt (bare template, or
 * template + a well-formed preferred-language line). Name- and locale-agnostic:
 * a stock role generated as "You are Lobe" or under `en-US` still matches after
 * the display name or locale changes. Anything else — extra lines, a changed
 * word, injected text in the language line — is customised.
 */
export const isUnmodifiedInboxSystemRole = (
  systemRole?: string | null,
  userLocale?: string,
): boolean => {
  if (!systemRole) return false;

  const role = normalizeTrailingWhitespace(systemRole);
  if (!role) return false;

  const assistantName = extractStockInboxAssistantName(role);
  if (!assistantName) return false;

  const baseline = createSystemRole(undefined, { assistantName });
  if (role === baseline) return true;
  if (userLocale && role === createSystemRole(userLocale, { assistantName })) return true;

  if (!role.startsWith(baseline)) return false;

  const rest = role.slice(baseline.length);
  const languagePrefix = `\n\n${LANGUAGE_LINE_PREFIX}`;
  if (!rest.startsWith(languagePrefix) || !rest.endsWith(LANGUAGE_LINE_SUFFIX)) return false;

  const tag = rest.slice(languagePrefix.length, rest.length - LANGUAGE_LINE_SUFFIX.length);
  if (!LOCALE_TAG_RE.test(tag)) return false;

  return role === createSystemRole(tag, { assistantName });
};

/**
 * Web-app providers skip the unmodified builtin inbox role so it is not
 * folded into the user turn. Callers must still gate on the server-projected
 * webApp capability; this helper only answers "is this the stock inbox prompt
 * on the inbox agent".
 */
export const shouldOmitBuiltinInboxSystemRole = ({
  agentSlug,
  systemRole,
  userLocale,
}: {
  agentSlug?: string | null;
  systemRole?: string | null;
  userLocale?: string;
}): boolean => isInboxAgentSlug(agentSlug) && isUnmodifiedInboxSystemRole(systemRole, userLocale);
