import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

/**
 * Resolve the model a generation in this conversation would actually use.
 *
 * Resolution mirrors the generation chain (`streamingExecutor` +
 * `agentConfigResolver`):
 * 1. Topic-scoped snapshot — the topic records the model it was created with
 *    (and later switches) on `metadata.model`, read via `getTopicById`.
 * 2. Shared agent default from `agentSelectors.getAgentConfigById`.
 *
 * UI guards keyed on model capabilities (e.g. the Claude prefill checks) must
 * resolve the same effective model, not a stale shared agent default.
 */
export const getEffectiveConversationModel = (context: {
  agentId?: string | null;
  topicId?: string | null;
}): string | undefined => {
  // Guard on topicDataMap: this runs inside UI actions whose tests build
  // partially-mocked chat stores, and a capability guard must never throw.
  const chatState = useChatStore.getState();
  const topicModel =
    context.topicId && chatState.topicDataMap
      ? topicSelectors.getTopicById(context.topicId)(chatState)?.metadata?.model
      : undefined;
  if (topicModel) return topicModel;

  if (!context.agentId) return undefined;

  return agentSelectors.getAgentConfigById(context.agentId)(getAgentStoreState())?.model;
};
