'use client';

import { builtinSkills as bundledBuiltinSkills } from '@lobechat/builtin-skills';
import { Button, Switch, Tooltip } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { SkillPermissions } from './controller';

const BUNDLED_BUILTIN_SKILL_KEYS = new Set(bundledBuiltinSkills.map((skill) => skill.identifier));

/**
 * `admin.skills.setEnabled` always publishes, and the server derives its
 * permission from the key alone: a bundled builtin materializes an override
 * (CREATE), anything else patches an existing row (UPDATE). Mirror that so the
 * switch is never offered for a write the server would reject.
 */
export const canSetSkillAvailability = (
  skillKey: string,
  permissions: Pick<SkillPermissions, 'canCreate' | 'canPublish' | 'canUpdate'>,
): boolean =>
  permissions.canPublish &&
  (BUNDLED_BUILTIN_SKILL_KEYS.has(skillKey) ? permissions.canCreate : permissions.canUpdate);

export interface SkillAvailabilitySwitchProps {
  /** Org-wide availability of the published skill. */
  checked: boolean;
  disabled: boolean;
  loading?: boolean;
  onChange: (enabled: boolean) => void;
}

/**
 * Org-wide availability control shared by the catalog list rows and the detail
 * header. Availability is a separate axis from distribution: a disabled skill
 * leaves the published catalog for every user, a merely optional one does not.
 */
export const SkillAvailabilitySwitch = memo<SkillAvailabilitySwitchProps>(
  ({ checked, disabled, loading, onChange }) => {
    const { t } = useTranslation('admin');

    return (
      <Tooltip title={t('skillCatalog.enabledSwitch.tooltip')}>
        <Switch
          checked={checked}
          disabled={disabled}
          loading={loading}
          size="small"
          title={t('skillCatalog.detail.identity.enabled')}
          onChange={(next) => onChange(next)}
        />
      </Tooltip>
    );
  },
);

SkillAvailabilitySwitch.displayName = 'AdminSkillAvailabilitySwitch';

export interface SkillDetailActionsProps {
  /** Combined busy / conflict / refresh-lock gate for non-archive actions. */
  actionsDisabled: boolean;
  /** Archive also blocks when the identity editor is dirty. */
  archiveDisabled: boolean;
  canArchive: boolean;
  canPublish: boolean;
  canPublishSelected: boolean;
  canUpdate: boolean;
  /** When true, validate/publish hide; save identity may appear instead. */
  dirty: boolean;
  /** Published org-wide availability (independent of the draft form switch). */
  enabled: boolean;
  /** Availability is owned by the published row, so an unsaved draft locks it. */
  enabledDisabled: boolean;
  enabledPending: boolean;
  identityDirty: boolean;
  isArchived: boolean;
  onArchive: () => void;
  onCreateVersion: () => void;
  onPublish: () => void;
  onSaveIdentity: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onValidate: () => void;
  saveFailed: boolean;
  selectedVersionId?: string;
}

/**
 * Header action matrix for the skill detail page.
 * Visibility is permission- and state-gated; disabled state is owned by the parent.
 */
const SkillDetailActions = memo<SkillDetailActionsProps>(
  ({
    actionsDisabled,
    archiveDisabled,
    canArchive,
    canPublish,
    canPublishSelected,
    canUpdate,
    dirty,
    enabled,
    enabledDisabled,
    enabledPending,
    identityDirty,
    isArchived,
    onArchive,
    onCreateVersion,
    onPublish,
    onSaveIdentity,
    onSetEnabled,
    onValidate,
    saveFailed,
    selectedVersionId,
  }) => {
    const { t } = useTranslation('admin');
    const navigate = useNavigate();

    return (
      <>
        <SkillAvailabilitySwitch
          checked={enabled}
          disabled={enabledDisabled}
          loading={enabledPending}
          onChange={onSetEnabled}
        />
        <Button onClick={() => navigate('/admin/skills')}>{t('skillCatalog.detail.back')}</Button>
        {canUpdate && !isArchived ? (
          <Button disabled={actionsDisabled} onClick={onCreateVersion}>
            {t('skillCatalog.version.create')}
          </Button>
        ) : null}
        {canUpdate && !isArchived && identityDirty ? (
          <Button disabled={actionsDisabled} type="primary" onClick={onSaveIdentity}>
            {saveFailed
              ? t('skillCatalog.actions.save.retry')
              : t('skillCatalog.actions.save.label')}
          </Button>
        ) : null}
        {canUpdate && !isArchived && selectedVersionId && !dirty ? (
          <Button disabled={actionsDisabled} onClick={onValidate}>
            {t('skillCatalog.actions.validate.label')}
          </Button>
        ) : null}
        {canPublish && !isArchived && selectedVersionId && canPublishSelected && !dirty ? (
          <Button disabled={actionsDisabled} type="primary" onClick={onPublish}>
            {t('skillCatalog.actions.publish.label')}
          </Button>
        ) : null}
        {canArchive && !isArchived ? (
          <Button danger disabled={archiveDisabled} onClick={onArchive}>
            {t('skillCatalog.actions.archive.label')}
          </Button>
        ) : null}
      </>
    );
  },
);

SkillDetailActions.displayName = 'SkillDetailActions';

export default SkillDetailActions;
