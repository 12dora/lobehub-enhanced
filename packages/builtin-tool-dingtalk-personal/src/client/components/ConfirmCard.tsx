'use client';

import { LinkedText } from '@lobechat/builtin-tool-dingtalk-workspace/client';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Block, Flexbox, Highlighter, Icon } from '@lobehub/ui';
import { Alert, Button, Skeleton, SkeletonText, Tag, toast } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { AlertTriangle } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { extractDingtalkPatUri, resolveDingtalkAction } from '@/features/DingtalkActionLink';
import DingtalkErrorAction from '@/features/DingtalkActionLink/DingtalkErrorAction';
import { dingtalkPersonalService } from '@/services/dingtalkPersonal';

import type { DingtalkPersonalPreview } from '../../types';
import type { DingtalkPersonalApiNameValue } from '../apiNames';
import { CONFIRM_VISIBLE_LINE_LIMIT } from './constants';
import { resolveDingtalkPersonalErrorCode } from './errorCode';
import { cardStyles } from './styles';

/** Every field optional: a partially filled preview still renders instead of crashing. */
type PreviewView = Partial<DingtalkPersonalPreview>;

interface ConfirmCardProps {
  apiName: DingtalkPersonalApiNameValue;
  args: Record<string, unknown>;
  /** The intervention's message: two pending writes never share a preview. */
  messageId: string;
  registerBeforeApprove?: BuiltinInterventionProps['registerBeforeApprove'];
}

/** Callback id under which the card claims the host's before-approve hook. */
export const CONFIRM_BEFORE_APPROVE_ID = 'dingtalk-personal-confirm';

/**
 * Thrown from the before-approve hook to abort the host's approve action. The
 * host awaits the callback before `approveToolCall`, so rejecting here is what
 * actually stops the write; the toast tells the user why.
 */
export class DingtalkPersonalNotPreviewedError extends Error {
  constructor(reason: 'error' | 'loading') {
    super(`DINGTALK_PERSONAL_PREVIEW_${reason.toUpperCase()}`);
    this.name = 'DingtalkPersonalNotPreviewedError';
  }
}

/** The preview is only valid for the exact args it was fetched for. */
const argsSignature = (args: Record<string, unknown>) => JSON.stringify(args ?? {});

/**
 * Identity of one preview request. The resolved payload carries it back, so the
 * gate only accepts the answer to the request this card instance made.
 */
export const previewRequestKey = (key: readonly unknown[]) => JSON.stringify(key);

/** Per mount: a remounted card never starts from a cached (possibly stale) preview. */
let previewMountSeq = 0;

const fetchPreview = async (
  apiName: DingtalkPersonalApiNameValue,
  args: Record<string, unknown>,
  requestKey: string,
) => {
  const preview = await dingtalkPersonalService.preview({ apiName, args });
  return { preview: preview as PreviewView, requestKey };
};

/**
 * A preview is fetched fresh for every card and never served from cache: the
 * todo behind the same `taskId` may have changed since an earlier confirmation.
 */
const PREVIEW_SWR_OPTIONS = {
  dedupingInterval: 0,
  keepPreviousData: false,
  revalidateIfStale: true,
  revalidateOnFocus: false,
  revalidateOnMount: true,
  revalidateOnReconnect: false,
  shouldRetryOnError: false,
} as const;

const asTextList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

/**
 * Confirm card shown before any `lobe-dingtalk-personal` write runs. The body is
 * ours, the 批准 / 拒绝 + 提交 footer is the host's standard approval footer.
 *
 * The card is also the write's gate: it registers a before-approve callback that
 * rejects unless the preview for *these* args came back, so a failed or still
 * loading preview can never be approved.
 */
const ConfirmCard = memo<ConfirmCardProps>((props) => {
  const { apiName, args, messageId, registerBeforeApprove } = props;
  const { t } = useTranslation('plugin');
  const [showAllLines, setShowAllLines] = useState(false);
  const [showRawArgs, setShowRawArgs] = useState(false);
  const [mountId] = useState(() => (previewMountSeq += 1));

  const signature = argsSignature(args ?? {});
  const swrKey = ['dingtalk-personal-preview', messageId, apiName, signature, mountId] as const;
  const requestKey = previewRequestKey(swrKey);

  const { data, error, isValidating } = useSWR(
    swrKey,
    () => fetchPreview(apiName, args ?? {}, requestKey),
    PREVIEW_SWR_OPTIONS,
  );

  // Only the finished answer to this card's own request counts: not a payload for
  // other arguments or another card, and not one that is being re-fetched.
  const preview =
    !error && !isValidating && data?.requestKey === requestKey ? data.preview : undefined;
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
          ? t('builtins.lobe-dingtalk-personal.render.confirm.approveBlocked')
          : t('builtins.lobe-dingtalk-personal.render.confirm.approvePending'),
      );

      throw new DingtalkPersonalNotPreviewedError(blockedReason);
    });
  }, [blockedReason, registerBeforeApprove, t]);

  const actionLabel = t(`builtins.lobe-dingtalk-personal.apiName.${apiName}` as const);

  // Diagnostics only, offered on the error path: a successful summary already says
  // what the call does in plain words.
  const rawArgs = (
    <Flexbox gap={6}>
      <Button
        className={cardStyles.diagnosticButton}
        size={'small'}
        type={'text'}
        onClick={() => setShowRawArgs((open) => !open)}
      >
        {t('builtins.lobe-dingtalk-personal.render.confirm.rawArgs')}
      </Button>
      {showRawArgs && (
        <Highlighter wrap language={'json'} showLanguage={false} variant={'outlined'}>
          {JSON.stringify(args ?? {}, null, 2)}
        </Highlighter>
      )}
    </Flexbox>
  );

  if (error) {
    const code = resolveDingtalkPersonalErrorCode(error);
    const action = resolveDingtalkAction(code, {
      patUri: code === 'DINGTALK_PERSONAL_PAT_REQUIRED' ? extractDingtalkPatUri(error) : undefined,
    });

    return (
      <Flexbox gap={8}>
        <Alert
          showIcon
          title={t('builtins.lobe-dingtalk-personal.render.confirm.blocked')}
          type={'error'}
          variant={'plain'}
          description={
            <Flexbox gap={4} style={{ fontSize: 12 }}>
              <div>
                {code
                  ? t(`builtins.lobe-dingtalk-personal.render.error.${code}` as const)
                  : t('builtins.lobe-dingtalk-personal.render.error.unknown')}
              </div>
              {action && (
                <div>
                  <DingtalkErrorAction action={action} />
                </div>
              )}
              <div>{t('builtins.lobe-dingtalk-personal.render.confirm.blockedHint')}</div>
            </Flexbox>
          }
        />
        {rawArgs}
      </Flexbox>
    );
  }

  // No preview and no error yet: the request is still on its way.
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

  const danger = preview.danger === true;
  const previewTitle = typeof preview.title === 'string' ? preview.title.trim() : '';
  // A line is never dropped: the user is confirming these rows, and a row that
  // vanished would be a row they approved without reading.
  const lines = asTextList(preview.lines);
  const visibleLines = showAllLines ? lines : lines.slice(0, CONFIRM_VISIBLE_LINE_LIMIT);
  const hiddenLineCount = lines.length - visibleLines.length;
  const warnings = asTextList(preview.warnings);

  return (
    <Block className={cx(danger && cardStyles.dangerCard)} variant={'outlined'} width={'100%'}>
      <div className={cardStyles.header}>
        <span className={cardStyles.headerText}>
          {t('builtins.lobe-dingtalk-personal.render.confirm.actingAs')}
        </span>
      </div>
      <div className={cardStyles.body}>
        <div className={cardStyles.titleRow}>
          <span className={cardStyles.title}>{previewTitle || actionLabel}</span>
          <Tag className={cardStyles.actionTag} color={danger ? 'error' : undefined}>
            {actionLabel}
          </Tag>
        </div>

        {visibleLines.length > 0 && (
          <div className={cardStyles.rows}>
            {visibleLines.map((line, index) => (
              <div className={cardStyles.line} key={`${index}-${line}`}>
                <LinkedText text={line} />
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
            {t('builtins.lobe-dingtalk-personal.render.showAll', { count: lines.length })}
          </Button>
        )}

        {warnings.length > 0 && (
          <div className={cardStyles.warnings}>
            {warnings.map((warning, index) => (
              <div className={cardStyles.warningItem} key={`${index}-${warning}`}>
                <Icon icon={AlertTriangle} size={13} style={{ marginBlockStart: 2 }} />
                <span>
                  <LinkedText text={warning} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Block>
  );
});

ConfirmCard.displayName = 'DingtalkPersonalConfirmCard';

export default ConfirmCard;
