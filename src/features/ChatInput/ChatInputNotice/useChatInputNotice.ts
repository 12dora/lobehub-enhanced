import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import {
  resolveEnableTargetProviderId,
  resolveStaleModelState,
} from '@/features/ModelSelect/resolveStaleModelState';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

interface ResolveChatInputNoticeParams {
  currentChatModel?: unknown;
  /** True while agent config (and thus the real model) is not yet settled. */
  isAgentModelPending: boolean;
  isHeterogeneousAgent: boolean;
  isModelConfigReady: boolean;
  isModelDisabled?: boolean;
}

const findEnabledChatModel = (
  enabledChatModelList: EnabledProviderWithModels[],
  model: string,
  provider: string,
) => {
  return enabledChatModelList
    .find((item) => item.id === provider)
    ?.children.find((item) => item.id === model);
};

export const resolveChatInputNotice = ({
  currentChatModel,
  isAgentModelPending,
  isHeterogeneousAgent,
  isModelConfigReady,
  isModelDisabled,
}: ResolveChatInputNoticeParams) => {
  // Model-config notices don't apply to heterogeneous agents (own toolchain),
  // before the model runtime config is ready, or before the agent's effective
  // model is settled. The last one matters on a cold page load: until
  // `agentMap` has the agent, the model resolves to the
  // DEFAULT_MODEL/DEFAULT_PROVIDER fallback, which is often absent from the
  // user's enabled list — that used to flash the "model offline" warning for a
  // frame before the real config resolved.
  if (
    !isHeterogeneousAgent &&
    isModelConfigReady &&
    !isAgentModelPending && // Example: an agent still references `gpt-4-32k`, or a model reclassified to
    // image/video; once absent from the chat selector, it should read as unavailable.
    !currentChatModel
  ) {
    // The model still exists — it is merely switched off. That is repairable
    // in one click, so offer the fix instead of the dead-end warning.
    if (isModelDisabled)
      return {
        action: 'enableModel' as const,
        key: 'input.modelDisabled',
        type: 'warning',
      } as const;

    return { action: undefined, key: 'input.modelUnavailable', type: 'warning' } as const;
  }
};

/** Union of every notice shape `resolveChatInputNotice` can return. */
export type ChatInputNotice = NonNullable<ReturnType<typeof resolveChatInputNotice>> & {
  actionDisabled?: boolean;
  actionDisabledReason?: string;
  actionLoading?: boolean;
  onAction?: () => Promise<void>;
};

export const useChatInputNotice = (): ChatInputNotice | undefined => {
  const { t } = useTranslation('chat');
  const { allowed: canManageAiInfra, reason: aiInfraPermissionReason } =
    usePermission('manage_provider_key');
  // Repairing the selection writes the agent's model — the same gate the model
  // switcher itself uses. A platform-pinned model can only be repaired in
  // place (see `isModelLocked` below).
  const { allowed: canCreateContent } = usePermission('create_content');
  const agentId = useAgentId();
  const [actionLoading, setActionLoading] = useState(false);

  const [isAgentConfigLoading, isHeterogeneousAgent, model, provider, isModelLocked] =
    useAgentStore((s) => [
      agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
      agentByIdSelectors.isAgentHeterogeneousById(agentId)(s),
      agentByIdSelectors.getAgentModelById(agentId)(s),
      agentByIdSelectors.getAgentModelProviderById(agentId)(s),
      agentByIdSelectors.isAgentModelLockedById(agentId)(s),
    ]);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();

  // Same gate as the ChatInput model trigger: an admin-pinned model cannot be
  // switched away from, so a fallback provider must never be enabled for it.
  const canSelectModel = canCreateContent && !isModelLocked;

  const enabledChatModelList = useEnabledChatModels();
  const builtinAiModelList = useAiInfraStore((s) => s.builtinAiModelList);
  const enabledAiProviders = useAiInfraStore((s) => s.enabledAiProviders);
  const modelRedirects = useAiInfraStore((s) => s.modelRedirects);
  const toggleProviderEnabled = useAiInfraStore((s) => s.toggleProviderEnabled);
  const toggleProviderModelEnabled = useAiInfraStore((s) => s.toggleProviderModelEnabled);
  const isModelConfigReady = useAiInfraStore((s) =>
    aiProviderSelectors.isInitAiProviderRuntimeState(s),
  );
  const currentChatModel = findEnabledChatModel(enabledChatModelList, model, provider);
  const staleModelState = useMemo(
    () =>
      isModelConfigReady
        ? resolveStaleModelState(
            { model, provider },
            {
              builtinAiModelList,
              enabledList: enabledChatModelList,
              modelRedirects,
              modelType: 'chat',
            },
          )
        : undefined,
    [builtinAiModelList, enabledChatModelList, isModelConfigReady, model, modelRedirects, provider],
  );
  const enableTargetProviderId =
    staleModelState?.status === 'notEnabled'
      ? resolveEnableTargetProviderId(
          { model, provider },
          {
            enabledAiProviders,
            enabledList: enabledChatModelList,
            metaProviderId: staleModelState.meta?.providerId,
          },
        )
      : undefined;
  /**
   * A locked Agent selection can only be repaired in place. Enabling an id-only fallback
   * provider would mutate global model settings while leaving the persisted selection stale.
   */
  const isModelDisabled = Boolean(
    enableTargetProviderId && (enableTargetProviderId === provider || canSelectModel),
  );

  const notice = resolveChatInputNotice({
    currentChatModel,
    // Upstream also waits on member-policy preference loading via
    // `useAgentModelSelection`; that hook is not on this tree (member model
    // selection policy not absorbed). Cold-load gate is agent-config only.
    isAgentModelPending: isAgentConfigLoading,
    isHeterogeneousAgent,
    isModelConfigReady,
    isModelDisabled,
  });

  const handleEnableModel = useCallback(async () => {
    const providerId = enableTargetProviderId;
    if (!providerId) return;

    setActionLoading(true);
    try {
      if (!enabledChatModelList.some((item) => item.id === providerId)) {
        await toggleProviderEnabled(providerId, true);
      }
      await toggleProviderModelEnabled({
        enabled: true,
        id: model,
        providerId,
        type: 'chat',
      });
      if (providerId !== provider) {
        try {
          await updateAgentConfigById(
            agentId,
            applyBusinessModelModeConfig({ model, provider: providerId }),
          );
        } catch (error) {
          console.error('Failed to select the enabled chat model provider:', error);
          toast.error(t('input.modelDisabled.selectionFailed'));
        }
      }
    } catch (error) {
      console.error('Failed to enable the selected chat model:', error);
      toast.error(t('input.modelDisabled.actionFailed'));
    } finally {
      setActionLoading(false);
    }
  }, [
    agentId,
    applyBusinessModelModeConfig,
    enableTargetProviderId,
    enabledChatModelList,
    model,
    provider,
    t,
    toggleProviderEnabled,
    toggleProviderModelEnabled,
    updateAgentConfigById,
  ]);

  if (notice?.action !== 'enableModel') return notice;

  return {
    ...notice,
    actionDisabled: !canManageAiInfra,
    actionDisabledReason: canManageAiInfra ? undefined : aiInfraPermissionReason,
    actionLoading,
    onAction: canManageAiInfra ? handleEnableModel : undefined,
  };
};
