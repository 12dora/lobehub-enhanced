'use client';

import { stopPropagation, Tooltip } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

export interface SkillEnabledSwitchProps {
  /**
   * Override the store-derived state (admin/org scope). When set, `onToggle`
   * must perform the write — the user settings store is not touched.
   */
  checked?: boolean;
  /** Alias of {@link SkillEnabledSwitchProps.checked}. */
  checkedOverride?: boolean;
  /** Block the toggle (missing permission, pending row…). */
  disabled?: boolean;
  /**
   * Bundled builtin skill / builtin tool identifier, installed skill
   * `identifier`, or platform catalog `skillKey`.
   */
  identifier: string;
  /** Which persistence slot the toggle writes to. */
  kind: 'builtin' | 'skill';
  /** External busy state (e.g. an org catalog write in flight). */
  loading?: boolean;
  /** Mandatory catalog distribution: locked on, users cannot disable it. */
  mandatory?: boolean;
  /** Notified after a successful toggle. */
  onChange?: (enabled: boolean) => void;
  /** Replaces the user-settings write (admin/org scope). */
  onToggle?: (enabled: boolean) => Promise<void> | void;
  size?: 'small';
}

/**
 * Enable/Disable control shown at the top-right of every skill row and detail
 * header.
 *
 * Disabling is not uninstalling: nothing is deleted, the skill is only removed
 * from the assistant's skill pool and from the `activateSkill` lookup, so it
 * stays listed and can be switched back on.
 *
 * Click events are stopped so the switch can sit inside a clickable row.
 */
const SkillEnabledSwitch = memo<SkillEnabledSwitchProps>(
  ({
    checked,
    checkedOverride,
    disabled,
    identifier,
    kind,
    loading,
    mandatory,
    onChange,
    onToggle,
    size = 'small',
  }) => {
    const { t } = useTranslation('setting');
    const [pending, setPending] = useState(false);

    const controlled = checked ?? checkedOverride;
    const storeEnabled = useToolStore(builtinToolSelectors.isSkillEnabled(identifier, kind));
    const setSkillEnabled = useToolStore((s) => s.setSkillEnabled);

    const isEnabled = mandatory ? true : (controlled ?? storeEnabled);

    const handleChange = async (next: boolean) => {
      if (mandatory) return;

      setPending(true);
      try {
        if (onToggle) await onToggle(next);
        else await setSkillEnabled({ enabled: next, identifier, kind });
        onChange?.(next);
      } finally {
        setPending(false);
      }
    };

    return (
      <Tooltip
        title={
          mandatory
            ? t('tools.skillEnabled.mandatory')
            : `${isEnabled ? t('tools.skillEnabled.on') : t('tools.skillEnabled.off')} — ${t('tools.skillEnabled.tooltip')}`
        }
      >
        <span onClick={stopPropagation}>
          <Switch
            checked={isEnabled}
            disabled={mandatory || disabled}
            loading={loading || pending}
            size={size}
            title={isEnabled ? t('tools.skillEnabled.on') : t('tools.skillEnabled.off')}
            onChange={(next) => {
              void handleChange(next);
            }}
          />
        </span>
      </Tooltip>
    );
  },
);

SkillEnabledSwitch.displayName = 'SkillEnabledSwitch';

export default SkillEnabledSwitch;
