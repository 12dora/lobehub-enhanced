'use client';

import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { UserIcon } from 'lucide-react';
import { Fragment, memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useBranding } from '@/enterprise/client/providers/RuntimeBrandingProvider';
import { usePermission } from '@/hooks/usePermission';

import AgentScopeSelect from '../AgentScopeSelect';
import { DINGTALK_COMMANDS, type MessengerPlatformCapabilities } from '../constants';
import {
  ConnectionRow,
  DetailLayout,
  IntegrationDetailSkeleton,
  styles as sharedStyles,
  useLinkActions,
  useMessengerData,
} from './shared';

const styles = createStaticStyles(({ css, cssVar }) => ({
  commandCell: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  commandLiteral: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    color: ${cssVar.colorText};
    white-space: nowrap;
  `,
  commandTable: css`
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(96px, 160px) 1fr;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
  `,
  headerCell: css`
    padding-block: 8px;
    padding-inline: 12px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

/**
 * `createdAt` arrives as a `Date` through the tRPC transformer, but tolerate a
 * raw ISO string so the row still renders if the transformer is bypassed.
 */
const formatLinkedAt = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : null;
};

interface DingTalkDetailProps {
  botUsername?: string | null;
  capabilities?: MessengerPlatformCapabilities;
  name: string;
  onBack: () => void;
}

/**
 * DingTalk is the only messenger platform with no connect flow: the enterprise
 * app is admin-provisioned and the account link is created server-side the
 * first time an employee messages the robot (identity = their DingTalk
 * account). So this page never offers "Connect" / "Disconnect" — it only
 * reports whether the first message has happened, lets the user pick which
 * agent replies, and documents the chat commands.
 */
const DingTalkDetail = memo<DingTalkDetailProps>(({ botUsername, capabilities, name, onBack }) => {
  const { t } = useTranslation('messenger');
  const { name: appName } = useBranding();
  const { allowed: canEdit } = usePermission('edit_own_content');

  const data = useMessengerData('dingtalk');
  const { handleSetActive } = useLinkActions({
    installationsMutate: data.installationsMutate,
    linksMutate: data.linksMutate,
    name,
    platform: 'dingtalk',
  });

  if (data.error && data.isInitialLoading)
    return <AsyncError error={data.error} variant={'block'} onRetry={data.mutate} />;
  if (data.isInitialLoading) return <IntegrationDetailSkeleton withNestedContent />;

  const link = data.links[0];
  const linkedAt = formatLinkedAt(link?.createdAt);
  const robotName = botUsername?.trim() || appName;
  // An admin can switch the chat half off independently of push. When it is
  // off, telling the user to message the robot would be advice that cannot
  // work, so the unlinked card carries the notice instead of the instruction.
  const chatDisabled = capabilities?.chat === false;

  return (
    <Flexbox gap={20}>
      <DetailLayout
        hasConnections={false}
        headerAction={null}
        name={name}
        platform="dingtalk"
        onBack={onBack}
      />

      <Flexbox gap={8}>
        <Text strong fontSize={15}>
          {t('messenger.dingtalk.status.title')}
        </Text>
        {link ? (
          <ConnectionRow
            icon={<Icon icon={UserIcon} size="small" />}
            label={t('messenger.dingtalk.status.accountLabel')}
            name={link.platformUserId}
            status="connected"
          >
            <Flexbox gap={12}>
              {linkedAt && (
                <Text fontSize={12} type="secondary">
                  {t('messenger.dingtalk.status.linkedAt', { time: linkedAt })}
                </Text>
              )}
              <Flexbox gap={6}>
                <AgentScopeSelect
                  agentLabel={t('messenger.dingtalk.agent.label')}
                  disabled={!canEdit}
                  link={link}
                  onSetActive={(agentId) => handleSetActive('', agentId)}
                />
                <Text fontSize={12} type="secondary">
                  {t('messenger.dingtalk.agent.hint')}
                </Text>
              </Flexbox>
            </Flexbox>
          </ConnectionRow>
        ) : (
          <Block className={sharedStyles.card}>
            <Flexbox gap={6}>
              <Text strong>
                {chatDisabled
                  ? t('messenger.dingtalk.status.chatUnavailable')
                  : t('messenger.dingtalk.status.notStarted')}
              </Text>
              <Text fontSize={13} type="secondary">
                {chatDisabled
                  ? t('messenger.dingtalk.capabilities.chatDisabled')
                  : t('messenger.dingtalk.status.instructions', { botName: robotName })}
              </Text>
            </Flexbox>
          </Block>
        )}

        {chatDisabled && link && (
          <Text fontSize={12} type="secondary">
            {t('messenger.dingtalk.capabilities.chatDisabled')}
          </Text>
        )}
        {capabilities?.push === false && (
          <Text fontSize={12} type="secondary">
            {t('messenger.dingtalk.capabilities.pushDisabled')}
          </Text>
        )}
      </Flexbox>

      <Flexbox gap={8}>
        <Text strong fontSize={15}>
          {t('messenger.dingtalk.commands.title')}
        </Text>
        <div className={styles.commandTable}>
          <div className={styles.headerCell}>
            <Text fontSize={12} type="secondary">
              {t('messenger.dingtalk.commands.commandHeader')}
            </Text>
          </div>
          <div className={styles.headerCell}>
            <Text fontSize={12} type="secondary">
              {t('messenger.dingtalk.commands.descriptionHeader')}
            </Text>
          </div>
          {DINGTALK_COMMANDS.map((item) => (
            <Fragment key={item.id}>
              <div className={styles.commandCell}>
                <span className={styles.commandLiteral}>{item.command}</span>
              </div>
              <div className={styles.commandCell}>
                <Text fontSize={13}>{t(`messenger.dingtalk.commands.${item.id}`)}</Text>
              </div>
            </Fragment>
          ))}
        </div>
        <Text fontSize={12} type="secondary">
          {t('messenger.dingtalk.commands.aliasNote')}
        </Text>
        <Text fontSize={12} type="secondary">
          {t('messenger.dingtalk.commands.groupNote')}
        </Text>
      </Flexbox>
    </Flexbox>
  );
});

DingTalkDetail.displayName = 'MessengerDingTalkDetail';

export default DingTalkDetail;
