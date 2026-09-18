import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { getModelDisplayName, useProviderLabel } from '@/utils/modelLabels';

/** Slug the main app gives every user's built-in default assistant. */
export const INBOX_AGENT_SLUG = 'inbox';

export interface TopicAgentSource {
  agentId?: string | null;
  agentSlug?: string | null;
  agentTitle?: string | null;
}

interface TopicModelSource extends TopicAgentSource {
  model?: string | null;
  provider?: string | null;
}

/**
 * The agent's human name: its title, else the localized default-assistant name for the inbox
 * agent, else the raw id (the only identity left for an untitled custom agent).
 */
export const resolveAgentDisplayName = (
  topic: TopicAgentSource,
  inboxLabel: string,
): string | undefined => {
  const title = topic.agentTitle?.trim();
  if (title) return title;
  if (topic.agentSlug === INBOX_AGENT_SLUG) return inboxLabel;
  return topic.agentId || undefined;
};

/**
 * `provider · model · agent` as shown on every conversation evidence surface. The em dash keeps
 * the row height stable when a topic carries no model attribution at all.
 */
export const formatTopicModelLine = (
  providerLabel: (providerId: string | null | undefined) => string,
  topic: TopicModelSource,
  inboxLabel: string,
): string =>
  [
    providerLabel(topic.provider),
    getModelDisplayName(topic.model, topic.provider),
    resolveAgentDisplayName(topic, inboxLabel),
  ]
    .filter(Boolean)
    .join(' · ') || '—';

/** Localized default-assistant name, reused from the main chat UI (`chat:inbox.title`). */
export const useInboxAgentLabel = (): string => {
  const { t } = useTranslation('chat');
  return t('inbox.title');
};

/** Formatters bound to the current locale's provider names and default-assistant label. */
export const useTopicModelLine = () => {
  const providerLabel = useProviderLabel();
  const inboxLabel = useInboxAgentLabel();

  const formatModelLine = useCallback(
    (topic: TopicModelSource) => formatTopicModelLine(providerLabel, topic, inboxLabel),
    [inboxLabel, providerLabel],
  );
  /** Speaker name for assistant turns — never the raw id (the turn falls back to its role label). */
  const assistantName = useCallback(
    (topic: TopicAgentSource | null | undefined) =>
      topic
        ? resolveAgentDisplayName(
            { agentSlug: topic.agentSlug, agentTitle: topic.agentTitle },
            inboxLabel,
          )
        : undefined,
    [inboxLabel],
  );

  return { assistantName, formatModelLine };
};
