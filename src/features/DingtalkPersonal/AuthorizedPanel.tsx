'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, confirmModal, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DingtalkSettingLink from '@/features/DingtalkActionLink/DingtalkSettingLink';
import { dingtalkPersonalService, type DingtalkPersonalStatus } from '@/services/dingtalkPersonal';

import { resolveDingtalkPersonalErrorCode, resolveRevokeErrorKey } from './errors';
import { formatAuthorizationTime, listEnabledFeatures } from './format';

type AuthorizedStatus = Extract<DingtalkPersonalStatus, { state: 'authorized' }>;

export interface AuthorizedPanelProps {
  compact?: boolean;
  /** After a revoke, the card keeps the DingTalk-side hint visible under the 授权 button. */
  onRevoked: () => void;
  /** Replaces the cached status with what the server answered (or re-reads it). */
  onStatusChange: (next?: DingtalkPersonalStatus) => Promise<unknown>;
  status: AuthorizedStatus;
}

/**
 * Who is authorized, since when, and what the administrator currently lets the assistant read.
 * The compact (chat) variant only confirms the authorization; managing it belongs to Settings.
 */
export const AuthorizedPanel = memo<AuthorizedPanelProps>(
  ({ compact, onRevoked, onStatusChange, status }) => {
    const { t } = useTranslation('setting');
    const [checking, setChecking] = useState(false);

    const authorizedAt = formatAuthorizationTime(status.authorizedAt);
    const checkedAt = formatAuthorizationTime(status.lastCheckedAt);
    const features = listEnabledFeatures(status.features);

    const summary = (
      <Text strong>
        {t('dingtalkPersonal.authorized.summary', {
          corpName: status.corpName,
          userName: status.dingtalkUserName,
        })}
      </Text>
    );

    if (compact)
      return (
        <Flexbox gap={4}>
          {summary}
          <Text fontSize={13} type={'secondary'}>
            {t('dingtalkPersonal.authorized.compactHint')}
          </Text>
        </Flexbox>
      );

    const check = async () => {
      if (checking) return;
      setChecking(true);
      try {
        const next = await dingtalkPersonalService.checkStatus();
        await onStatusChange(next);
        if (next.state === 'authorized') toast.success(t('dingtalkPersonal.check.valid'));
        else if (next.state === 'expired') toast.error(t('dingtalkPersonal.check.expired'));
      } catch {
        toast.error(t('dingtalkPersonal.check.failed'));
      } finally {
        setChecking(false);
      }
    };

    const requestRevoke = () => {
      confirmModal({
        cancelText: t('dingtalkPersonal.actions.cancel'),
        content: t('dingtalkPersonal.revoke.confirmDesc'),
        okButtonProps: { danger: true },
        okText: t('dingtalkPersonal.actions.revoke'),
        onOk: async () => {
          try {
            await dingtalkPersonalService.revoke();
          } catch (error) {
            toast.error(t(resolveRevokeErrorKey(resolveDingtalkPersonalErrorCode(error)) as never));
            return;
          }
          toast.success(t('dingtalkPersonal.revoke.success'));
          onRevoked();
          // The credential is gone: every card says so at once, whether or not the re-read below
          // gets through (a failed one must not leave 已授权 next to the success toast).
          await onStatusChange({ state: 'unauthorized' });
          try {
            await onStatusChange();
          } catch {
            /* the next revalidation catches the card up */
          }
        },
        title: t('dingtalkPersonal.revoke.confirmTitle'),
      });
    };

    return (
      <Flexbox gap={10}>
        {summary}
        <Flexbox gap={2}>
          {authorizedAt ? (
            <Text fontSize={13} type={'secondary'}>
              {t('dingtalkPersonal.authorized.at', { time: authorizedAt })}
            </Text>
          ) : null}
          {checkedAt ? (
            <Text fontSize={13} type={'secondary'}>
              {t('dingtalkPersonal.authorized.checkedAt', { time: checkedAt })}
            </Text>
          ) : null}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
          <Text fontSize={13} type={'secondary'}>
            {t('dingtalkPersonal.authorized.features')}
          </Text>
          {features.length === 0 ? (
            <>
              <Text fontSize={13} type={'secondary'}>
                {t('dingtalkPersonal.authorized.featuresNone')}
              </Text>
              <DingtalkSettingLink kind={'adminImConnectors'} />
            </>
          ) : (
            features.map((feature) => (
              <Tag key={feature} size={'small'}>
                {t(`dingtalkPersonal.features.${feature}` as never)}
              </Tag>
            ))
          )}
        </Flexbox>
        <Flexbox horizontal gap={8} wrap={'wrap'}>
          <Button loading={checking} size={'small'} onClick={() => void check()}>
            {t('dingtalkPersonal.actions.check')}
          </Button>
          <Button danger size={'small'} onClick={requestRevoke}>
            {t('dingtalkPersonal.actions.revoke')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

AuthorizedPanel.displayName = 'DingtalkPersonalAuthorizedPanel';
