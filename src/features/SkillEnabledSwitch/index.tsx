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
  /**
   * Display name of the skill. Folded into the control's accessible name so
   * screen-reader users can tell the switches of a list apart.
   */
  label?: string;
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
    label,
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
      } catch {
        // The write owner (tool store / admin scope) rolls its own state back
        // and surfaces the error; the switch only has to leave the busy state,
        // after which it re-renders from whatever state actually persisted.
      } finally {
        setPending(false);
      }
    };

    const stateLabel = isEnabled ? t('tools.skillEnabled.on') : t('tools.skillEnabled.off');
    // The switch renders as a bare button with no visible text and the base-ui
    // component forwards no aria-* props, so `title` is the only accessible-name
    // hook available — without the skill name every switch in a list would be
    // announced identically.
    const accessibleName = label ? `${label}: ${stateLabel}` : stateLabel;

    return (
      <Tooltip
        title={
          mandatory
            ? t('tools.skillEnabled.mandatory')
            : `${stateLabel} — ${t('tools.skillEnabled.tooltip')}`
        }
      >
        <span onClick={stopPropagation}>
          <Switch
            checked={isEnabled}
            disabled={mandatory || disabled}
            loading={loading || pending}
            size={size}
            title={accessibleName}
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
