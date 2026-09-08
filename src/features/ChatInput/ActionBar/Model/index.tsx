import { ModelIcon } from '@lobehub/icons';
import { Center, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useActionBarContext } from '../context';

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    transition: scale 400ms cubic-bezier(0.215, 0.61, 0.355, 1);
  `,
  modelDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    :hover {
      background: transparent;
    }

    :active {
      div {
        scale: 1;
      }
    }
  `,
  /**
   * Platform-managed: the pill keeps its size and icon but drops every affordance that
   * suggests it can be changed — no pointer, no hover fill, no press feedback.
   */
  modelManaged: css`
    cursor: default;
    border-radius: 24px;
  `,
  /**
   * The managed pill stays keyboard-reachable so its tooltip opens on focus and screen
   * readers reach the explanation; only the edit affordance is gone, not the control.
   */
  managedTrigger: css`
    position: relative;
    display: inline-flex;
    border-radius: 24px;

    &:focus-visible {
      outline: 1px solid ${cssVar.colorBorder};
      outline-offset: 2px;
    }
  `,
  visuallyHidden: css`
    position: absolute;

    overflow: hidden;

    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;

    white-space: nowrap;

    clip-path: inset(50%);
  `,
  model: css`
    cursor: pointer;
    border-radius: 24px;

    :hover {
      background: ${cssVar.colorFillSecondary};
    }

    :active {
      div {
        scale: 0.8;
      }
    }
  `,
}));

const ModelSwitch = memo(() => {
  const { t } = useTranslation('chat');
  const managedDescriptionId = useId();
  const { actionSize, dropdownPlacement } = useActionBarContext();
  const blockSize = actionSize?.blockSize ?? 32;
  const iconSize = actionSize?.size ?? 20;
  const { allowed: canCreateContent, reason } = usePermission('create_content');

  const agentId = useAgentId();
  const [model, provider, isPlatformManaged, updateAgentConfigById] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    agentByIdSelectors.isAgentPlatformManagedById(agentId)(s),
    s.updateAgentConfigById,
  ]);
  const applyBusinessModelModeConfig = useBusinessModelModeConfig();

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      if (!canCreateContent) return;

      await updateAgentConfigById(agentId, applyBusinessModelModeConfig(params));
    },
    [agentId, applyBusinessModelModeConfig, canCreateContent, updateAgentConfigById],
  );

  const trigger = (
    <Center
      height={blockSize}
      width={blockSize}
      className={cx(
        canCreateContent && isPlatformManaged ? styles.modelManaged : styles.model,
        !canCreateContent && styles.modelDisabled,
      )}
    >
      <div className={styles.icon}>
        <ModelIcon model={model} size={iconSize} />
      </div>
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
  // The pill stays focusable and named: keyboard users open the tooltip on focus, and the
  // accessible name plus description carry the model and the reason it cannot be changed.
  if (isPlatformManaged)
    return (
      <Tooltip title={t('modelSwitch.managedByAdmin')}>
        <span
          aria-disabled
          aria-describedby={managedDescriptionId}
          aria-label={model}
          className={styles.managedTrigger}
          role={'button'}
          tabIndex={0}
        >
          {trigger}
          <span className={styles.visuallyHidden} id={managedDescriptionId}>
            {t('modelSwitch.managedByAdmin')}
          </span>
        </span>
      </Tooltip>
    );

  return (
    <ModelSwitchPanel
      model={model}
      placement={dropdownPlacement}
      provider={provider}
      onModelChange={handleModelChange}
    >
      {trigger}
    </ModelSwitchPanel>
  );
});

ModelSwitch.displayName = 'ModelSwitch';

export default ModelSwitch;
