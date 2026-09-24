'use client';

import type { ApprovalAutomationTier } from '@lobechat/types';
import { DINGTALK_CONSOLE_LINKS } from '@lobechat/utils/appLink';
import { Button, Select, Text } from '@lobehub/ui/base-ui';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ActionLink, { resolveActionHref } from '@/components/ActionLink';
import type {
  AdminImConnectorProbeWorkspacePermissionsOutput,
  DingtalkPermissionProbe,
} from '@/enterprise/client/services/adminImConnectors';
import { adminImConnectorsService } from '@/enterprise/client/services/adminImConnectors';

import { InfraField, InfraSwitchRow } from '../infra/InfraField';
import { infraFormStyles as formStyles } from '../infra/styles';
import {
  APPROVAL_AUTOMATION_TIER_OPTIONS,
  type DingTalkConnectorDraft,
  isDingTalkNotifyAppConfigured,
} from './draft';
import { imConnectorStyles as styles } from './styles';

/** The answer to 检查权限, one entry per capability — the contract's own output (§3.1). */
export type ImConnectorWorkspaceProbeResult = AdminImConnectorProbeWorkspacePermissionsOutput;

/**
 * `admin.imConnectors.probeWorkspacePermissions`, narrowed to what this section calls.
 *
 * The card injects the real service and a test a stub, so the section never reaches for the module
 * singleton in a test; the shape is the contract's, not a local copy of it.
 */
export interface ImConnectorWorkspaceService {
  probeWorkspacePermissions: () => Promise<ImConnectorWorkspaceProbeResult>;
}

const defaultWorkspaceService: ImConnectorWorkspaceService = adminImConnectorsService;

/** The capabilities in the order they are switched on, which is also the order they are probed. */
const CAPABILITIES = ['approval', 'todo', 'calendar'] as const;

/**
 * DingTalk's own "apply for these scopes" page, when the probe kept it. Read defensively: the field
 * is optional on the contract and only an https URL is ever linked.
 */
export const readProbeApplyUrl = (result: DingtalkPermissionProbe): string | undefined => {
  const target = resolveActionHref(
    (result as DingtalkPermissionProbe & { applyUrl?: unknown }).applyUrl,
  );
  return target?.external ? target.href : undefined;
};

export interface ProbeApplyLink {
  href: string;
  labelKey:
    | 'systemGeneral.imConnectors.workspace.probe.applyLink'
    | 'systemGeneral.imConnectors.workspace.probe.consoleLink';
}

/**
 * Where an admin grants what a probe found missing: DingTalk's own apply page when the probe kept
 * one, otherwise the developer console home for a forbidden reading with named scopes (labelled as
 * the console, since it is not the application page itself).
 */
export const resolveProbeApplyLink = (
  result: DingtalkPermissionProbe,
): ProbeApplyLink | undefined => {
  const applyUrl = readProbeApplyUrl(result);
  if (applyUrl)
    return { href: applyUrl, labelKey: 'systemGeneral.imConnectors.workspace.probe.applyLink' };

  const missingScopes = (result.missingScopes ?? []).filter((scope) => scope.length > 0);
  if (!result.ok && result.reason === 'forbidden' && missingScopes.length > 0)
    return {
      href: DINGTALK_CONSOLE_LINKS.developerConsole,
      labelKey: 'systemGeneral.imConnectors.workspace.probe.consoleLink',
    };

  return undefined;
};

const toTier = (value: unknown): ApprovalAutomationTier | null =>
  typeof value === 'string' &&
  (APPROVAL_AUTOMATION_TIER_OPTIONS as readonly string[]).includes(value)
    ? (value as ApprovalAutomationTier)
    : null;

export interface WorkspaceCapabilitiesSectionProps {
  /** SYSTEM_OPERATE. Without it the block is a reading: no probe. */
  canOperate: boolean;
  /** The card is saving (or the admin cannot write): the fields follow the rest of the form. */
  disabled: boolean;
  draft: DingTalkConnectorDraft;
  onPatch: (next: Partial<DingTalkConnectorDraft>) => void;
  /** Injectable for tests. */
  service?: ImConnectorWorkspaceService;
}

/**
 * 工作台能力 — approval, to-dos and calendar handled as the member's own DingTalk identity.
 *
 * It sits under the notification app because it runs on it: every call is made with the 服务号
 * token, so without those credentials there is nothing to switch on and the block says so rather
 * than offering settings that cannot take effect. The four fields belong to the connector row and
 * are written by the card's own 保存; only 检查权限 acts on its own, because it asks DingTalk which
 * scopes the stored app has been granted right now.
 */
export const WorkspaceCapabilitiesSection = memo<WorkspaceCapabilitiesSectionProps>(
  ({ canOperate, disabled, draft, onPatch, service = defaultWorkspaceService }) => {
    const { t } = useTranslation('admin');

    const [probing, setProbing] = useState(false);
    const [probe, setProbe] = useState<ImConnectorWorkspaceProbeResult | undefined>();
    const [probeFailed, setProbeFailed] = useState(false);

    const notifyAppConfigured = isDingTalkNotifyAppConfigured(draft);
    // Nothing here can take effect without the notification app, so an unconfigured one locks the
    // whole block rather than letting an admin save switches that stay inert.
    const locked = disabled || !notifyAppConfigured;

    const runProbe = useCallback(async () => {
      if (!canOperate || probing) return;
      setProbing(true);
      setProbeFailed(false);
      try {
        setProbe(await service.probeWorkspacePermissions());
      } catch {
        setProbe(undefined);
        setProbeFailed(true);
      } finally {
        setProbing(false);
      }
    }, [canOperate, probing, service]);

    const resolveProbeText = useCallback(
      (result: DingtalkPermissionProbe): string => {
        if (result.ok) return t('systemGeneral.imConnectors.workspace.probe.ok');

        const missingScopes = (result.missingScopes ?? []).filter((scope) => scope.length > 0);
        // The scope names are what an admin has to grant in the DingTalk console, so they are named
        // rather than summarised.
        if (result.reason === 'forbidden' && missingScopes.length > 0)
          return t('systemGeneral.imConnectors.workspace.probe.missingScopes', {
            scopes: missingScopes.join(', '),
          });

        return t(
          `systemGeneral.imConnectors.workspace.probe.reason.${result.reason ?? 'unknown'}` as never,
        );
      },
      [t],
    );

    // The tier is a promise about rules that run unattended, so what the chosen one allows is
    // stated under the control rather than hidden in a tooltip.
    const tierNote = draft.workspaceApprovalEnabled
      ? t(
          `systemGeneral.imConnectors.workspace.tier.hints.${draft.approvalAutomationTier}` as never,
        )
      : t('systemGeneral.imConnectors.workspace.tier.requiresApproval');

    const capabilityLabels = useMemo(
      () =>
        CAPABILITIES.map((capability) => ({
          capability,
          label: t(`systemGeneral.imConnectors.workspace.fields.${capability}` as never),
        })),
      [t],
    );

    return (
      <div className={styles.section}>
        <span className={styles.sectionTitle}>
          {t('systemGeneral.imConnectors.workspace.title')}
        </span>
        <span className={formStyles.hint}>
          {t('systemGeneral.imConnectors.workspace.description')}
        </span>

        {notifyAppConfigured ? null : (
          <Text type="secondary">{t('systemGeneral.imConnectors.workspace.notConfigured')}</Text>
        )}

        <div className={formStyles.fieldGrid}>
          <InfraSwitchRow
            checked={draft.workspaceApprovalEnabled}
            disabled={locked}
            hint={t('systemGeneral.imConnectors.workspace.hints.approval')}
            label={t('systemGeneral.imConnectors.workspace.fields.approval')}
            onChange={(checked) => onPatch({ workspaceApprovalEnabled: checked })}
          />
          <InfraSwitchRow
            checked={draft.workspaceTodoEnabled}
            disabled={locked}
            hint={t('systemGeneral.imConnectors.workspace.hints.todo')}
            label={t('systemGeneral.imConnectors.workspace.fields.todo')}
            onChange={(checked) => onPatch({ workspaceTodoEnabled: checked })}
          />
          <InfraSwitchRow
            checked={draft.workspaceCalendarEnabled}
            disabled={locked}
            hint={t('systemGeneral.imConnectors.workspace.hints.calendar')}
            label={t('systemGeneral.imConnectors.workspace.fields.calendar')}
            onChange={(checked) => onPatch({ workspaceCalendarEnabled: checked })}
          />
          <InfraField label={t('systemGeneral.imConnectors.workspace.fields.tier')} note={tierNote}>
            {(field) => (
              <Select
                {...field.control}
                // Automatic approval only exists inside the 审批 capability; with it off the tier
                // would be a setting with nothing to apply to.
                disabled={locked || !draft.workspaceApprovalEnabled}
                style={{ width: '100%' }}
                value={draft.approvalAutomationTier}
                options={APPROVAL_AUTOMATION_TIER_OPTIONS.map((tier) => ({
                  label: t(`systemGeneral.imConnectors.workspace.tier.options.${tier}` as never),
                  value: tier,
                }))}
                onChange={(next) => {
                  const tier = toTier(next);
                  if (tier) onPatch({ approvalAutomationTier: tier });
                }}
              />
            )}
          </InfraField>
        </div>

        {canOperate ? (
          <div className={styles.notifyRow}>
            <Button
              // Without the notification app the probe has no token to ask with; its answer would
              // be three times 未配置服务号, which the notice above already says.
              disabled={!notifyAppConfigured}
              loading={probing}
              size="small"
              onClick={() => void runProbe()}
            >
              {t('systemGeneral.imConnectors.workspace.probe.run')}
            </Button>
            {probeFailed ? (
              <Text type="danger">{t('systemGeneral.imConnectors.workspace.probe.failed')}</Text>
            ) : null}
            {probe ? (
              <div className={styles.probeList}>
                {capabilityLabels.map((row) => {
                  const result = probe[row.capability];
                  const applyLink = resolveProbeApplyLink(result);
                  return (
                    <div className={styles.probeRow} key={row.capability}>
                      <Text type={result.ok ? 'success' : 'danger'}>
                        {t('systemGeneral.imConnectors.workspace.probe.row', {
                          capability: row.label,
                          status: resolveProbeText(result),
                        })}
                      </Text>
                      {applyLink ? (
                        <ActionLink href={applyLink.href}>{t(applyLink.labelKey)}</ActionLink>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
);

WorkspaceCapabilitiesSection.displayName = 'AdminImConnectorWorkspaceCapabilitiesSection';
