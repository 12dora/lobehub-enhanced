'use client';

import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Button, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { UserRoundCheck } from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DingtalkSettingLink from '@/features/DingtalkActionLink/DingtalkSettingLink';
import type { DingtalkPersonalStatus } from '@/services/dingtalkPersonal';

import { AuthorizedPanel } from './AuthorizedPanel';
import {
  resolveDingtalkPersonalLinkKind,
  resolveIdentityRequiredKey,
  resolveIdentityRequiredLink,
  resolveStartErrorKey,
} from './errors';
import { LoginPanel } from './LoginPanel';
import { styles } from './styles';
import { useDingtalkPersonalLogin } from './useDingtalkPersonalLogin';
import { useDingtalkPersonalStatus } from './useDingtalkPersonalStatus';
import { useRemainingMs } from './useRemainingMs';

export interface AuthorizeCardProps {
  /**
   * Start the login by itself, once, as soon as the status says one is needed (`unauthorized` or
   * `expired`, and no pending login to resume) — the `?dingtalkPersonal=authorize` deep link a tool
   * result hands the member. Ignored when already authorized or the identity is missing.
   */
  autoStart?: boolean;
  /**
   * Chat tool-result variant: tighter, no description, and no 检查状态 / 撤销授权 — managing the
   * authorization belongs to 设置 → 连接器.
   */
  compact?: boolean;
  /** Called when this card sees the member go from not authorized to authorized. */
  onAuthorized?: () => void;
}

const resolveTag = (
  status: DingtalkPersonalStatus | undefined,
  loginPending: boolean,
): { color?: string; key: string } | undefined => {
  if (loginPending) return { color: 'processing', key: 'dingtalkPersonal.tag.pending' };

  switch (status?.state) {
    case 'authorized': {
      return { color: 'success', key: 'dingtalkPersonal.tag.authorized' };
    }
    case 'expired': {
      return { color: 'warning', key: 'dingtalkPersonal.tag.expired' };
    }
    case 'identity_required': {
      return { color: 'warning', key: 'dingtalkPersonal.tag.identityRequired' };
    }
    case 'unauthorized': {
      return { key: 'dingtalkPersonal.tag.unauthorized' };
    }
    default: {
      return undefined;
    }
  }
};

/**
 * 钉钉个人数据 — the member's own, one-time authorization for the assistant to read their DingTalk
 * to-dos, group messages and work reports, and — when the admin enables them — their documents,
 * 钉盘, knowledge bases and sheets (through the `aihub-dws` sidecar, device-code login).
 *
 * Renders nothing while the deployment has the capability off (`disabled`).
 */
export const AuthorizeCard = memo<AuthorizeCardProps>(({ autoStart, compact, onAuthorized }) => {
  const { t } = useTranslation('setting');
  const { data: status, error, isLoading, isValidating, mutate } = useDingtalkPersonalStatus();
  const [revoked, setRevoked] = useState(false);

  const resetLoginRef = useRef<() => void>(() => {});
  const handleSucceeded = useCallback(() => {
    toast.success(t('dingtalkPersonal.login.succeeded'));
    void (async () => {
      try {
        const next = await mutate();
        // Authorized: the effect below clears the job. Anything else: show what the server says.
        if (next?.state !== 'authorized') resetLoginRef.current();
      } catch {
        /* keep the success line until the next revalidation catches the card up */
      }
    })();
  }, [mutate, t]);

  const { cancel, cancelFailed, cancelling, login, reset, start, startError, starting } =
    useDingtalkPersonalLogin({
      onSucceeded: handleSucceeded,
      pendingLogin: status?.state === 'unauthorized' ? status.pendingLogin : undefined,
    });
  resetLoginRef.current = reset;

  const remainingMs = useRemainingMs(login?.status === 'pending' ? login.expiresAt : undefined);
  const awaitingConsent =
    status?.state !== 'authorized' && login?.status === 'pending' && remainingMs !== 0;

  const onAuthorizedRef = useRef(onAuthorized);
  onAuthorizedRef.current = onAuthorized;
  const previousStateRef = useRef<DingtalkPersonalStatus['state'] | undefined>(undefined);
  const state = status?.state;

  useEffect(() => {
    const previous = previousStateRef.current;
    previousStateRef.current = state;
    if (state !== 'authorized') return;
    // Authorized wherever it happened (this card, another card, another tab): a job or failure
    // this card still holds is stale, and must not come back if the member revokes later.
    setRevoked(false);
    reset();
    if (previous && previous !== 'authorized') onAuthorizedRef.current?.();
  }, [reset, state]);

  // One shot per mount, decided on a fresh read (a cached status from the chat card may be stale):
  // a member who cancels the auto-started code is not handed another one.
  const autoStartHandledRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartHandledRef.current || !status || isValidating) return;
    autoStartHandledRef.current = true;
    if (login) return;
    if (status.state === 'unauthorized' || status.state === 'expired') void start();
  }, [autoStart, isValidating, login, start, status]);

  const onStatusChange = useCallback(
    (next?: DingtalkPersonalStatus) => (next ? mutate(next, { revalidate: false }) : mutate()),
    [mutate],
  );

  // The server may finalize a job that had already been approved when it is cancelled, so the
  // status is re-read either way: it says whether the member ended up authorized after all.
  const cancelAndRefresh = useCallback(async () => {
    await cancel();
    try {
      await mutate();
    } catch {
      /* the next revalidation catches the card up */
    }
  }, [cancel, mutate]);

  if (status?.state === 'disabled') return null;

  const renderStartButton = (label: string) => (
    <Flexbox horizontal gap={8}>
      <Button loading={starting} type={'primary'} onClick={() => void start()}>
        {label}
      </Button>
    </Flexbox>
  );

  let body: ReactNode;
  if (!status) {
    body =
      error && !isLoading ? (
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Text type={'danger'}>{t('dingtalkPersonal.status.loadFailed')}</Text>
          <Button size={'small'} onClick={() => void mutate()}>
            {t('dingtalkPersonal.status.retry')}
          </Button>
        </Flexbox>
      ) : (
        <Text type={'secondary'}>{t('dingtalkPersonal.status.loading')}</Text>
      );
  } else if (status.state === 'identity_required') {
    const link = resolveIdentityRequiredLink(status.code);
    body = (
      <Flexbox gap={6}>
        <Text type={'warning'}>{t(resolveIdentityRequiredKey(status.code) as never)}</Text>
        {link ? <DingtalkSettingLink kind={link} /> : null}
      </Flexbox>
    );
  } else if (status.state === 'authorized') {
    // Before any local login: once the member is authorized, a job this card still holds is stale.
    body = (
      <AuthorizedPanel
        compact={compact}
        status={status}
        onRevoked={() => setRevoked(true)}
        onStatusChange={onStatusChange}
      />
    );
  } else if (login) {
    body = (
      <LoginPanel
        cancelFailed={cancelFailed}
        cancelling={cancelling}
        compact={compact}
        login={login}
        remainingMs={remainingMs}
        starting={starting}
        onCancel={() => void cancelAndRefresh()}
        onRetry={() => void start()}
      />
    );
  } else if (status.state === 'expired') {
    body = (
      <Flexbox gap={8}>
        <Text type={'warning'}>
          {status.dingtalkUserName
            ? t('dingtalkPersonal.expired.withName', { name: status.dingtalkUserName })
            : t('dingtalkPersonal.expired.title')}
        </Text>
        {renderStartButton(t('dingtalkPersonal.actions.reauthorize'))}
      </Flexbox>
    );
  } else {
    body = (
      <Flexbox gap={8}>
        <Text fontSize={13} type={'secondary'}>
          {t('dingtalkPersonal.unauthorized.hint')}
        </Text>
        {renderStartButton(t('dingtalkPersonal.actions.authorize'))}
        {revoked ? (
          <Text fontSize={12} type={'secondary'}>
            {t('dingtalkPersonal.revoke.hint')}
          </Text>
        ) : null}
      </Flexbox>
    );
  }

  const tag = resolveTag(status, awaitingConsent);
  const startErrorLink = startError ? resolveDingtalkPersonalLinkKind(startError.code) : undefined;

  return (
    <Block
      className={styles.root}
      data-testid={'dingtalk-personal-authorize-card'}
      padding={compact ? 12 : 16}
      variant={'outlined'}
    >
      <Flexbox gap={compact ? 10 : 12}>
        <Flexbox horizontal className={styles.header} gap={12} justify={'space-between'}>
          <Flexbox gap={4} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Icon icon={UserRoundCheck} size={16} />
              <Text strong fontSize={compact ? 14 : 15}>
                {t('dingtalkPersonal.title')}
              </Text>
            </Flexbox>
            {compact ? null : (
              <Text fontSize={13} type={'secondary'}>
                {t('dingtalkPersonal.description')}
              </Text>
            )}
          </Flexbox>
          {tag ? (
            <Tag color={tag.color} size={'small'}>
              {t(tag.key as never)}
            </Tag>
          ) : null}
        </Flexbox>
        {body}
        {startError && status?.state !== 'authorized' ? (
          <Flexbox gap={4}>
            <Text type={'danger'}>{t(resolveStartErrorKey(startError.code) as never)}</Text>
            {startErrorLink ? <DingtalkSettingLink kind={startErrorLink} /> : null}
          </Flexbox>
        ) : null}
      </Flexbox>
    </Block>
  );
});

AuthorizeCard.displayName = 'DingtalkPersonalAuthorizeCard';

export default AuthorizeCard;
