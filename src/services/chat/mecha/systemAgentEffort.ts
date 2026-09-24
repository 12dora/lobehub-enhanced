import type {
  EffortModelCard,
  GenerateObjectEffortParams,
  ModelExtendParams,
} from '@lobechat/model-runtime';
import {
  findEffortControl,
  isAggregationProviderForEffortLookup,
  pickGenerateObjectEffortParams,
  projectServiceModelEffort,
  readExtendParamsFromModelCards,
} from '@lobechat/model-runtime';
import type { LobeAgentChatConfig } from '@lobechat/types';

// Pure level math shared with the in-chat pill and the ControlsForm sliders, so a
// service model lands on exactly the level those controls would show for its card.
import {
  hasModelEffortNarrowing,
  type ModelEffortSettings,
  resolveCurrentEffortLevel,
} from '@/features/ChatInput/ActionBar/ThinkingEffort/resolveEffortLevel';
import { getAiInfraStoreState } from '@/store/aiInfra';
import type { SystemAgentItem } from '@/types/user/settings';

type EffortSettingsCard = EffortModelCard & { settings?: ModelEffortSettings };

const matchesModelId = (card: EffortModelCard, model: string) =>
  card.id === model || card.config?.deploymentName === model;

const hasExtendParams = (card: EffortModelCard | undefined) =>
  !!card?.settings?.extendParams?.length;

/**
 * The per-model effort narrowing (`settings.effortLevels` / `defaultEffortLevel`) of the
 * card whose `extendParams` `readExtendParamsFromModelCards` resolves the control from:
 * the exact `(id, providerId)` card, or — for aggregation providers whose own card is
 * empty — the first same-id card that declares extend params.
 */
const readEffortSettingsFromModelCards = (
  cards: readonly EffortSettingsCard[],
  model: string,
  provider: string,
): ModelEffortSettings | undefined => {
  const providerMatch = cards.find(
    (card) => matchesModelId(card, model) && card.providerId === provider,
  );
  if (hasExtendParams(providerMatch)) return providerMatch?.settings;
  if (!isAggregationProviderForEffortLookup(provider)) return undefined;

  return cards.find((card) => matchesModelId(card, model) && hasExtendParams(card))?.settings;
};

/**
 * Translate a service model's stored `reasoningEffort` into wire params.
 *
 * Looks up `settings.extendParams` from the client aiInfra store, then delegates
 * to the store-agnostic `projectServiceModelEffort` projector. Returns `{}` when
 * the level is unset/`null` or the model exposes no discrete effort control.
 *
 * When the card narrows its control (`settings.effortLevels` / `defaultEffortLevel`),
 * the stored level is first clamped onto that narrowed set — nearest offered level,
 * ties → stronger; a level the control does not know → the card's default — so a
 * collapsed card never receives a level it has no variant for.
 */
export const resolveSystemAgentEffortParams = (
  item: Pick<SystemAgentItem, 'model' | 'provider' | 'reasoningEffort'> | undefined,
): GenerateObjectEffortParams => {
  // `null` is a stored clear ("use the provider default") and reads exactly like absent.
  if (!item?.reasoningEffort) return {};

  const { model, provider } = item;
  const { enabledAiModels, builtinAiModelList } = getAiInfraStoreState();
  // Enabled first, then builtin — same order as `getModelCard`. When only
  // LobeHub is enabled the origin card lives in the builtin catalog.
  const cards: EffortSettingsCard[] = [...(enabledAiModels ?? []), ...(builtinAiModelList ?? [])];
  const extendParams = readExtendParamsFromModelCards(cards, model, provider);

  let reasoningEffort: string | null | undefined = item.reasoningEffort;
  const control = findEffortControl(extendParams);
  const modelSettings = control
    ? readEffortSettingsFromModelCards(cards, model, provider)
    : undefined;

  // Cards without narrowing keep the projector's own clamp (unknown level → registry
  // default) exactly as before.
  if (control && hasModelEffortNarrowing(modelSettings)) {
    reasoningEffort = resolveCurrentEffortLevel({
      config: { [control.definition.configKey]: reasoningEffort } as LobeAgentChatConfig,
      definition: control.definition,
      key: control.key,
      model,
      modelSettings,
    });
  }

  return pickGenerateObjectEffortParams(
    projectServiceModelEffort({ extendParams, model, reasoningEffort }),
  );
};

/**
 * Request params for a call site that merges a whole `SystemAgentItem` into its payload.
 *
 * `reasoningEffort` is a settings-only field — those merge sites put every key they are
 * given straight on the wire, and strict upstreams reject unknown params — so it is
 * replaced by the provider-shaped params it resolves to.
 */
export const withSystemAgentEffortParams = <T extends SystemAgentItem>(
  item: T | undefined,
): Partial<Omit<T, 'reasoningEffort'>> & ModelExtendParams => {
  // Callers spread the result into a `merge(...)`, which already treated a missing
  // service-model config as "no params" — keep that shape rather than throwing.
  if (!item) return {};

  const { reasoningEffort: _settingOnly, ...wire } = item;

  return { ...wire, ...resolveSystemAgentEffortParams(item) };
};
