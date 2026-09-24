'use client';

import { copyToClipboard, Flexbox, Icon } from '@lobehub/ui';
import { Button, Text, toast } from '@lobehub/ui/base-ui';
import { QRCode } from 'antd';
import { Copy, ExternalLink, LoaderCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DingtalkSettingLink from '@/features/DingtalkActionLink/DingtalkSettingLink';
import type { DingtalkPersonalLoginView } from '@/services/dingtalkPersonal';

import { type LoginFailureMessage, resolveLoginFailure } from './errors';
import { formatCountdown, resolveVerificationUrl } from './format';
import { styles } from './styles';

const CODE_ELAPSED: LoginFailureMessage = { key: 'dingtalkPersonal.login.error.expired' };

export interface LoginPanelProps {
  /** The last 取消 did not reach the server: the code can still be approved, so it stays shown. */
  cancelFailed?: boolean;
  cancelling: boolean;
  compact?: boolean;
  login: DingtalkPersonalLoginView;
  onCancel: () => void;
  onRetry: () => void;
  /** Time left on a pending code (`useRemainingMs`); the card owns the clock for its tag too. */
  remainingMs?: number;
  starting: boolean;
}

/**
 * The device-code step: the QR of the code-included link, the code itself and how long it lives,
 * and the two ways to reach DingTalk from a desktop browser (scan it, or send the link to oneself).
 * Once the job is over without success it becomes the reason plus a retry.
 */
export const LoginPanel = memo<LoginPanelProps>(
  ({ cancelFailed, cancelling, compact, login, onCancel, onRetry, remainingMs, starting }) => {
    const { t } = useTranslation('setting');

    // The code is useless once its clock runs out, whatever the next poll says.
    const failure =
      login.status === 'pending' && remainingMs === 0 ? CODE_ELAPSED : resolveLoginFailure(login);

    if (failure)
      return (
        <Flexbox gap={8}>
          <Text type={'danger'}>{t(failure.key as never, failure.values)}</Text>
          {failure.link ? <DingtalkSettingLink kind={failure.link} /> : null}
          <Flexbox horizontal gap={8}>
            <Button loading={starting} size={'small'} type={'primary'} onClick={onRetry}>
              {t('dingtalkPersonal.actions.reauthorize')}
            </Button>
          </Flexbox>
        </Flexbox>
      );

    if (login.status === 'succeeded')
      return <Text type={'success'}>{t('dingtalkPersonal.login.succeeded')}</Text>;

    const codeRow = (
      <Flexbox horizontal align={'baseline'} gap={8} wrap={'wrap'}>
        <Text type={'secondary'}>{t('dingtalkPersonal.login.codeLabel')}</Text>
        <span className={styles.code}>{login.userCode}</span>
      </Flexbox>
    );
    const countdown =
      remainingMs === undefined ? null : (
        <Text className={styles.countdown} type={'secondary'}>
          {t('dingtalkPersonal.login.countdown', { time: formatCountdown(remainingMs) })}
        </Text>
      );
    const cancelButton = (
      <Button loading={cancelling} size={'small'} type={'text'} onClick={onCancel}>
        {t('dingtalkPersonal.actions.cancel')}
      </Button>
    );
    const cancelFailedNote = cancelFailed ? (
      <Text fontSize={13} type={'danger'}>
        {t('dingtalkPersonal.login.cancelFailed')}
      </Text>
    ) : null;

    // Only DingTalk's own https page becomes a QR code, a copy action or a link.
    const verificationUrl = resolveVerificationUrl(login.verificationUrl);
    if (!verificationUrl)
      return (
        <div className={styles.details}>
          {codeRow}
          {countdown}
          <Text fontSize={13} type={'danger'}>
            {t('dingtalkPersonal.login.invalidLink')}
          </Text>
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            {cancelButton}
          </Flexbox>
          {cancelFailedNote}
        </div>
      );

    const copyLink = async () => {
      try {
        await copyToClipboard(verificationUrl);
        toast.success(t('dingtalkPersonal.login.linkCopied'));
      } catch {
        toast.error(t('dingtalkPersonal.login.copyFailed'));
      }
    };

    return (
      <div className={styles.loginBody}>
        <div className={styles.qr}>
          <QRCode
            bgColor={'#fff'}
            bordered={false}
            color={'#000'}
            size={compact ? 128 : 160}
            value={verificationUrl}
          />
        </div>
        <div className={styles.details}>
          {codeRow}
          {countdown}
          <Text fontSize={13}>{t('dingtalkPersonal.login.scanHint')}</Text>
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            <Button icon={Copy} size={'small'} onClick={() => void copyLink()}>
              {t('dingtalkPersonal.actions.copyLink')}
            </Button>
            <Button
              href={verificationUrl}
              icon={ExternalLink}
              rel={'noopener noreferrer'}
              size={'small'}
              target={'_blank'}
            >
              {t('dingtalkPersonal.actions.openLink')}
            </Button>
            {cancelButton}
          </Flexbox>
          {cancelFailedNote}
          <span className={styles.waiting}>
            <Icon spin icon={LoaderCircle} size={12} />
            {t('dingtalkPersonal.login.waiting')}
          </span>
        </div>
      </div>
    );
  },
);

LoginPanel.displayName = 'DingtalkPersonalLoginPanel';
