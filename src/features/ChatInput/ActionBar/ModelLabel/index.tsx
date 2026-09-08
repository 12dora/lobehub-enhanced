import { Center, Flexbox, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo, useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessModelModeConfig } from '@/business/client/hooks/useBusinessAgentMode';
import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useActionBarContext } from '../context';
import { useModelDisplayName } from './useModelDisplayName';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  /**
   * The managed label has no chevron, but it must not be *narrower* than the
   * interactive one: this pill sits in the send row, so dropping 12px + the 2px
   * gap would slide the send button sideways the moment the managed flag
   * resolves (or the composer switches between a managed and a personal agent).
   * The slot is always rendered and always the icon's size; only its content is
   * conditional, so the pill's box never changes.
   */
  chevronSlot: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    inline-size: 12px;
    block-size: 12px;
  `,
  /**
   * Shown instead of the raw model id while the model catalogue has not resolved yet —
   * an internal id is developer noise, and painting it would only be replaced by the real
   * display name a moment later. Fixed width so the swap costs no re-flow either.
   */
  namePlaceholder: css`
    inline-size: 72px;
    block-size: 12px;
    border-radius: 4px;
    background: ${cssVar.colorFillTertiary};
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
  /**
   * The managed label stays keyboard-reachable so its tooltip opens on focus and screen
   * readers reach the explanation; only the edit affordance is gone, not the control.
   */
  managedTrigger: css`
    position: relative;
    display: inline-flex;
    border-radius: 6px;

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
}));

const ModelLabel = memo(() => {
  const { t } = useTranslation('chat');
  const managedDescriptionId = useId();
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

  // `undefined` while the model catalogue has not resolved the name yet — see the hook.
  const displayName = useModelDisplayName(model, provider);

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
      height={28}
      paddingInline={6}
      className={cx(
        isManaged ? styles.triggerManaged : styles.trigger,
        !canCreateContent && styles.triggerDisabled,
      )}
    >
      <Flexbox horizontal align={'center'} gap={2}>
        {displayName ? (
          <span className={styles.name}>{displayName}</span>
        ) : (
          <span aria-hidden className={styles.namePlaceholder} />
        )}
        {/* The chevron promises a menu; a managed model has none to open. The
            slot around it stays, so the pill — and the send row it sits in —
            keeps the same width in both states and never re-flows. */}
        <span aria-hidden className={styles.chevronSlot} data-testid={'model-label-chevron-slot'}>
          {!isManaged && <ChevronDownIcon className={styles.chevron} size={12} />}
        </span>
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
  // The label stays focusable and named: keyboard users open the tooltip on focus, and the
  // accessible name plus description carry the model and the reason it cannot be changed.
  if (isManaged)
    return (
      <Tooltip title={t('modelSwitch.managedByAdmin')}>
        <span
          aria-disabled
          aria-describedby={managedDescriptionId}
          aria-label={displayName ?? model}
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
