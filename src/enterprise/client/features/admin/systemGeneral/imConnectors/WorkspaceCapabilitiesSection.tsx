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
import { ConnectorSection } from './ConnectorSection';
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

type WorkspaceCapability = (typeof CAPABILITIES)[number];

/** Reasons 检查权限 has its own copy for; anything else reads as「无法检查」. */
const PROBE_REASONS = new Set(['forbidden', 'not_configured', 'unreachable']);

/**
 * How the server says it skipped a capability because its module is not installed. Read loosely:
 * the output may carry it as a reason or a status, and an older server never sends it.
 */
const SKIPPED_MARKERS = new Set(['disabled', 'module_disabled', 'not_installed', 'skipped']);

/** Whether 检查权限 skipped this capability because its module is off (shown as 未安装). */
export const isProbeSkipped = (result: DingtalkPermissionProbe): boolean => {
  const { reason, skipped, status } = result as DingtalkPermissionProbe & {
    skipped?: unknown;
    status?: unknown;
  };
  return (
    skipped === true ||
    (typeof reason === 'string' && SKIPPED_MARKERS.has(reason)) ||
    (typeof status === 'string' && SKIPPED_MARKERS.has(status))
  );
};

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
  /** Module `dingtalkApproval`: the 审批 switch and the 自动审批档位. Defaults to shown. */
  showApproval?: boolean;
  /** Module `dingtalkWorkspace`: the 待办 and 日程 switches. Defaults to shown. */
  showWorkspace?: boolean;
}

/**
 * 工作台能力 — approval, to-dos and calendar handled as the member's own DingTalk identity.
 *
 * It sits under the notification app because it runs on it: every call is made with that app's
 * token, so without those credentials there is nothing to switch on and the block says so rather
 * than offering settings that cannot take effect. The four fields belong to the connector row and
 * are written by the card's own 保存; only 检查权限 acts on its own, because it asks DingTalk which
 * scopes the stored app has been granted right now.
 */
export const WorkspaceCapabilitiesSection = memo<WorkspaceCapabilitiesSectionProps>(
  ({
    canOperate,
    disabled,
    draft,
    onPatch,
    service = defaultWorkspaceService,
    showApproval = true,
    showWorkspace = true,
  }) => {
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
        if (isProbeSkipped(result)) return t('systemGeneral.imConnectors.workspace.probe.skipped');
        if (result.ok) return t('systemGeneral.imConnectors.workspace.probe.ok');

        const missingScopes = (result.missingScopes ?? []).filter((scope) => scope.length > 0);
        // The scope names are what an admin has to grant in the DingTalk console, so they are named
        // rather than summarised.
        if (result.reason === 'forbidden' && missingScopes.length > 0)
          return t('systemGeneral.imConnectors.workspace.probe.missingScopes', {
            scopes: missingScopes.join(', '),
          });

        // A reason this client has no copy for (a newer server) still reads as a verdict.
        const reason =
          typeof result.reason === 'string' && PROBE_REASONS.has(result.reason)
            ? result.reason
            : 'unknown';
        return t(`systemGeneral.imConnectors.workspace.probe.reason.${reason}` as never);
      },
      [t],
    );

    // What the chosen tier allows depends on the value, so it is stated under the control rather
    // than hidden in a tooltip — and only while it can apply.
    const tierNote = draft.workspaceApprovalEnabled
      ? t(
          `systemGeneral.imConnectors.workspace.tier.hints.${draft.approvalAutomationTier}` as never,
        )
      : undefined;

    /** Only the capabilities this deployment installed are offered, and their probe shown. */
    const capabilityLabels = useMemo(
      () =>
        CAPABILITIES.filter((capability) =>
          capability === 'approval' ? showApproval : showWorkspace,
        ).map((capability) => ({
          capability,
          label: t(`systemGeneral.imConnectors.workspace.fields.${capability}` as never),
        })),
      [showApproval, showWorkspace, t],
    );

    const switches: Record<
      WorkspaceCapability,
      { checked: boolean; patch: (checked: boolean) => Partial<DingTalkConnectorDraft> }
    > = {
      approval: {
        checked: draft.workspaceApprovalEnabled,
        patch: (checked) => ({ workspaceApprovalEnabled: checked }),
      },
      calendar: {
        checked: draft.workspaceCalendarEnabled,
        patch: (checked) => ({ workspaceCalendarEnabled: checked }),
      },
      todo: {
        checked: draft.workspaceTodoEnabled,
        patch: (checked) => ({ workspaceTodoEnabled: checked }),
      },
    };

    return (
      <ConnectorSection
        help={t('systemGeneral.imConnectors.workspace.description')}
        title={t('systemGeneral.imConnectors.workspace.title')}
        extra={
          canOperate ? (
            <Button
              // Without the notification app the probe has no token to ask with; its answer would
              // only repeat the notice below.
              disabled={!notifyAppConfigured}
              loading={probing}
              size="small"
              onClick={() => void runProbe()}
            >
              {t('systemGeneral.imConnectors.workspace.probe.run')}
            </Button>
          ) : undefined
        }
      >
        {notifyAppConfigured ? null : (
          <Text type="warning">{t('systemGeneral.imConnectors.workspace.notConfigured')}</Text>
        )}

        <div className={styles.tileGrid}>
          {capabilityLabels.map(({ capability, label }) => (
            <InfraSwitchRow
              checked={switches[capability].checked}
              className={styles.tile}
              disabled={locked}
              help={t(`systemGeneral.imConnectors.workspace.hints.${capability}` as never)}
              key={capability}
              label={label}
              onChange={(checked) => onPatch(switches[capability].patch(checked))}
            />
          ))}
        </div>

        {showApproval ? (
          <div className={styles.fieldGrid}>
            <InfraField
              label={t('systemGeneral.imConnectors.workspace.fields.tier')}
              note={tierNote}
            >
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
        ) : null}

        {probeFailed ? (
          <Text type="danger">{t('systemGeneral.imConnectors.workspace.probe.failed')}</Text>
        ) : null}
        {probe ? (
          <div className={styles.probeList}>
            {capabilityLabels.map((row) => {
              const result = probe[row.capability];
              // Tolerate an answer without this capability (it simply is not reported).
              if (!result) return null;
              const skipped = isProbeSkipped(result);
              const applyLink = skipped ? undefined : resolveProbeApplyLink(result);
              return (
                <div className={styles.probeRow} key={row.capability}>
                  <Text type={skipped ? 'secondary' : result.ok ? 'success' : 'danger'}>
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
      </ConnectorSection>
    );
  },
);

WorkspaceCapabilitiesSection.displayName = 'AdminImConnectorWorkspaceCapabilitiesSection';
