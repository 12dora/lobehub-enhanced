import { Center, Flexbox, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from '../../hooks/useAgentId';
import { useActionBarContext } from '../context';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  name: css`
    overflow: hidden;

    max-width: 160px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  trigger: css`
    cursor: pointer;
    border-radius: 6px;

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  triggerDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    :hover {
      background: transparent;
    }
  `,
  /**
   * Platform-managed: the label keeps its size and copy but drops every affordance that
   * suggests it can be changed — no pointer, no hover fill, no chevron.
   */
  triggerManaged: css`
    cursor: default;
    border-radius: 6px;
  `,
}));

const ModelLabel = memo(() => {
  const { t } = useTranslation('chat');
  const { dropdownPlacement } = useActionBarContext();
  const { allowed: canCreateContent, reason } = usePermission('create_content');

  const agentId = useAgentId();
  const [model, provider, isPlatformManaged, updateAgentConfigById] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    agentByIdSelectors.isAgentPlatformManagedById(agentId)(s),
    s.updateAgentConfigById,
  ]);
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();

  const enabledModel = useAiInfraStore(aiModelSelectors.getEnabledModelById(model, provider));
  const displayName = enabledModel?.displayName || model;

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      if (!canCreateContent) return;

      await updateAgentConfigById(agentId, applyBusinessModelModeConfig(params));
    },
    [agentId, applyBusinessModelModeConfig, canCreateContent, updateAgentConfigById],
  );

  const isManaged = canCreateContent && isPlatformManaged;

  const trigger = (
    <Center
      horizontal
      aria-disabled={isManaged ? true : undefined}
      height={28}
      paddingInline={6}
      className={cx(
        isManaged ? styles.triggerManaged : styles.trigger,
        !canCreateContent && styles.triggerDisabled,
      )}
    >
      <Flexbox horizontal align={'center'} gap={2}>
        <span className={styles.name}>{displayName}</span>
        {/* The chevron promises a menu; a managed model has none to open. */}
        {!isManaged && <ChevronDownIcon className={styles.chevron} size={12} />}
      </Flexbox>
    </Center>
  );

  if (!canCreateContent)
    return (
      <Tooltip title={reason}>
        <div>{trigger}</div>
      </Tooltip>
    );

  // The admin owns the model of a platform-managed agent: the server overlays it on every
  // read and rejects user edits, so offering the switch panel would only revert visually.
  if (isManaged)
    return (
      <Tooltip title={t('modelSwitch.managedByAdmin')}>
        <div>{trigger}</div>
      </Tooltip>
    );

  return (
    <ModelSwitchPanel
      model={model}
      openOnHover={false}
      placement={dropdownPlacement}
      provider={provider}
      onModelChange={handleModelChange}
    >
      {trigger}
    </ModelSwitchPanel>
  );
});

ModelLabel.displayName = 'ModelLabel';

export default ModelLabel;
