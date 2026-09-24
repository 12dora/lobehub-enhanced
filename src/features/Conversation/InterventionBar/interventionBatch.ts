import { isCustomInteractionIdentifier } from '../Messages/AssistantGroup/Tool/Detail/Intervention/customInteractionHandlers';
import { isInterventionArgsBlacklisted } from '../Messages/AssistantGroup/Tool/Detail/Intervention/securityBlacklist';
import { type PendingIntervention } from '../store/slices/data/pendingInterventions';

/**
 * Whether a pending call is a plain approve / reject decision.
 *
 * Never batched, they keep their own card:
 * - human-answer interactions (ask-user questions, pickers, CC/Codex prompts):
 *   they need the user's input;
 * - calls whose args hit the security blacklist (the card's red warning): the
 *   runtime always wants a human to look at those, one by one.
 */
export const isBatchDecidable = (item: PendingIntervention): boolean =>
  item.intervention.kind !== 'toolResult' &&
  !isCustomInteractionIdentifier(item.identifier, item.apiName) &&
  !isInterventionArgsBlacklisted(item.requestArgs);

/**
 * The approve / reject calls parked by the same assistant message as the active
 * tab, in display order.
 *
 * `getTurnId` returns the tool message's `parentId` — the assistant message that
 * emitted the call. Grouping by it (not `assistantGroupId`, which standalone tool
 * rows lack) keeps stale pending rows of an older turn out of the batch; calls
 * whose parent is unknown never join one.
 */
export const getInterventionBatch = (
  interventions: PendingIntervention[],
  activeIndex: number,
  getTurnId: (item: PendingIntervention) => string | null | undefined,
): PendingIntervention[] => {
  const anchor = interventions[activeIndex] ?? interventions[0];
  if (!anchor) return [];

  const turnId = getTurnId(anchor);
  if (!turnId) return [];

  return interventions.filter((item) => getTurnId(item) === turnId && isBatchDecidable(item));
};
