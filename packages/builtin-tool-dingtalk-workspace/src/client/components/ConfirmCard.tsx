'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter, Icon } from '@lobehub/ui';
import { Alert, Button, Skeleton, SkeletonText, Tag, toast } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { AlertTriangle } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { dingtalkWorkspaceService } from '@/services/dingtalkWorkspace';

import type { DingtalkWorkspaceApiNameType } from '../apiNames';
import { DINGTALK_WORKSPACE_DANGER_API_NAMES } from '../apiNames';
import { CONFIRM_VISIBLE_LINE_LIMIT } from './constants';
import { resolveDingtalkErrorCode } from './previewError';
import { cardStyles } from './styles';

/**
 * Server-resolved summary of what a write API would do (shared contract §5
 * `preview`). Every field is optional here so a partially filled preview still
 * renders instead of crashing the intervention.
 */
export interface DingtalkWorkspacePreview {
  actingAs?: { deptPath?: string; name?: string };
  danger?: boolean;
  lines?: { label: string; value: string }[];
  title?: string;
  warnings?: string[];
}

interface ConfirmCardProps {
  apiName: DingtalkWorkspaceApiNameType;
  args: Record<string, unknown>;
  registerBeforeApprove?: BuiltinInterventionProps['registerBeforeApprove'];
}

/** Callback id under which the card claims the host's before-approve hook. */
export const CONFIRM_BEFORE_APPROVE_ID = 'dingtalk-workspace-confirm';

/**
 * Thrown from the before-approve hook to abort the host's approve action. The
 * host awaits the callback before `approveToolCall`, so rejecting here is what
 * actually stops the write; the toast tells the user why.
 */
export class DingtalkWorkspaceNotPreviewedError extends Error {
  constructor(reason: 'error' | 'loading') {
    super(`DINGTALK_PREVIEW_${reason.toUpperCase()}`);
    this.name = 'DingtalkWorkspaceNotPreviewedError';
  }
}

/** The preview is only valid for the exact args it was fetched for. */
const argsSignature = (args: Record<string, unknown>) => JSON.stringify(args ?? {});

const fetchPreview = async (apiName: string, args: Record<string, unknown>) => {
  const preview = await dingtalkWorkspaceService.preview({ apiName, args });
  return { preview: preview as DingtalkWorkspacePreview, signature: argsSignature(args) };
};

/**
 * Confirm card shown before any `lobe-dingtalk-workspace` write runs. The body is
 * ours, the 批准 / 拒绝 + 提交 footer is the host's standard approval footer.
 *
 * The card is also the write's gate: it registers a before-approve callback that
 * rejects unless the preview for *these* args came back, so a failed or still
 * loading preview can never be approved — neither with 批准 nor with
 * 「批准，且类似操作不再询问」, both of which run this hook first.
 */
const ConfirmCard = memo<ConfirmCardProps>(({ apiName, args, registerBeforeApprove }) => {
  const { t } = useTranslation('plugin');
  const [showAllLines, setShowAllLines] = useState(false);
  const [showRawArgs, setShowRawArgs] = useState(false);

  const signature = argsSignature(args ?? {});

  const { data, error } = useSWR(
    ['dingtalk-workspace-preview', apiName, signature],
    () => fetchPreview(apiName, args ?? {}),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );

  // Never trust a payload fetched for other arguments: the summary the user read
  // has to be the summary of the call that is about to run.
  const preview = data?.signature === signature ? data.preview : undefined;
  const blockedReason: 'error' | 'loading' | undefined = error
    ? 'error'
    : preview
      ? undefined
      : 'loading';

  useEffect(() => {
    if (!registerBeforeApprove) return;

    return registerBeforeApprove(CONFIRM_BEFORE_APPROVE_ID, () => {
      if (!blockedReason) return;

      toast.error(
        blockedReason === 'error'
          ? t('builtins.lobe-dingtalk-workspace.ui.confirm.approveBlocked')
          : t('builtins.lobe-dingtalk-workspace.ui.confirm.approvePending'),
      );

      throw new DingtalkWorkspaceNotPreviewedError(blockedReason);
    });
  }, [blockedReason, registerBeforeApprove, t]);

  const actionLabel = t(`builtins.lobe-dingtalk-workspace.ui.apiLabel.${apiName}` as const);

  // Only offered on the error path: a successful summary already says what the
  // call does in plain words, while the raw payload carries ids and `staff:`
  // tokens the rest of the UI deliberately strips.
  const rawArgs = (
    <Flexbox gap={6}>
      <Button
        className={cardStyles.footerButton}
        size={'small'}
        type={'text'}
        onClick={() => setShowRawArgs((open) => !open)}
      >
        {t('builtins.lobe-dingtalk-workspace.ui.confirm.rawArgs')}
      </Button>
      {showRawArgs && (
        <Highlighter wrap language={'json'} showLanguage={false} variant={'outlined'}>
          {JSON.stringify(args ?? {}, null, 2)}
        </Highlighter>
      )}
    </Flexbox>
  );

  if (error) {
    const code = resolveDingtalkErrorCode(error);

    return (
      <Flexbox gap={8}>
        <Alert
          showIcon
          title={t('builtins.lobe-dingtalk-workspace.ui.confirm.blocked')}
          type={'error'}
          variant={'plain'}
          description={
            <Flexbox gap={4} style={{ fontSize: 12 }}>
              <div>
                {code
                  ? t(`builtins.lobe-dingtalk-workspace.ui.error.${code}` as const)
                  : t('builtins.lobe-dingtalk-workspace.ui.error.unknown')}
              </div>
              <div>{t('builtins.lobe-dingtalk-workspace.ui.confirm.blockedHint')}</div>
            </Flexbox>
          }
        />
        {rawArgs}
      </Flexbox>
    );
  }

  // No preview and no error yet: the request is still on its way. Saying "cannot
  // preview" here would describe a write that is about to preview just fine.
  if (!preview) {
    return (
      <Block variant={'outlined'} width={'100%'}>
        <div className={cardStyles.body}>
          <Skeleton height={20} radius={4} width={'40%'} />
          <SkeletonText rows={3} />
        </div>
      </Block>
    );
  }

  const danger = preview.danger ?? DINGTALK_WORKSPACE_DANGER_API_NAMES.has(apiName);
  const lines = preview.lines ?? [];
  const visibleLines = showAllLines ? lines : lines.slice(0, CONFIRM_VISIBLE_LINE_LIMIT);
  const hiddenLineCount = lines.length - visibleLines.length;
  const warnings = preview.warnings ?? [];
  // An empty name would render as「以  的钉钉身份执行」, which reads as an unidentified
  // identity rather than the caller's own — say it without the name instead.
  const actingAsName = preview.actingAs?.name?.trim();
  const actingAsText = actingAsName
    ? t('builtins.lobe-dingtalk-workspace.ui.confirm.actingAs', { name: actingAsName })
    : t('builtins.lobe-dingtalk-workspace.ui.confirm.actingAsUnknown');

  return (
    <Block className={cx(danger && cardStyles.dangerCard)} variant={'outlined'} width={'100%'}>
      <div className={cardStyles.header}>
        <span className={cardStyles.headerText}>{actingAsText}</span>
        {preview.actingAs?.deptPath && (
          <span className={cardStyles.headerMeta}>{preview.actingAs.deptPath}</span>
        )}
      </div>
      <div className={cardStyles.body}>
        <div className={cardStyles.titleRow}>
          <span className={cardStyles.title}>{preview.title || actionLabel}</span>
          <Tag className={cardStyles.actionTag} color={danger ? 'error' : undefined}>
            {actionLabel}
          </Tag>
        </div>

        {visibleLines.length > 0 && (
          <div className={cardStyles.rows}>
            {visibleLines.map((line, index) => (
              <div className={cardStyles.row} key={`${line.label}-${index}`}>
                <span className={cardStyles.label}>{line.label}</span>
                <span className={cardStyles.value}>{line.value}</span>
              </div>
            ))}
          </div>
        )}

        {hiddenLineCount > 0 && (
          <Button
            className={cardStyles.footerButton}
            size={'small'}
            type={'text'}
            onClick={() => setShowAllLines(true)}
          >
            {t('builtins.lobe-dingtalk-workspace.ui.confirm.showAll', { count: lines.length })}
          </Button>
        )}

        {warnings.length > 0 && (
          <div className={cardStyles.warnings}>
            {warnings.map((warning, index) => (
              <div className={cardStyles.warningItem} key={`${warning}-${index}`}>
                <Icon icon={AlertTriangle} size={13} style={{ marginBlockStart: 2 }} />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Block>
  );
});

ConfirmCard.displayName = 'DingtalkWorkspaceConfirmCard';

export default ConfirmCard;
