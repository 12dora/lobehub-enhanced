'use client';

import { Block, Tooltip } from '@lobehub/ui';
import { Button, Switch } from '@lobehub/ui/base-ui';
import type { ReactNode } from 'react';
import { memo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { InfraHelpButton } from '@/enterprise/client/features/admin/systemGeneral/infra/InfraField';
import type { AdminStatusAlertChannel } from '@/enterprise/client/services/adminSystem';

import { alertSettingsStyles as styles } from './styles';
import type { AlertSettingsEditor } from './useAlertSettingsEditor';

/** Why the channel cannot deliver, with a direct link to where that is fixed. */
export interface ChannelUnavailable {
  reason: string;
  to: string;
}

interface ChannelTestProps {
  channel: AdminStatusAlertChannel;
  editor: AlertSettingsEditor;
  unavailable?: ChannelUnavailable;
}

/**
 * 「发送测试」 plus its last result. When the test cannot run, the tooltip names the actual cause
 * (backend missing / channel not saved as on / unsaved edits) instead of one generic hint.
 */
const ChannelTest = memo<ChannelTestProps>(({ channel, editor, unavailable }) => {
  const { t } = useTranslation('admin');
  const state = editor.tests[channel];
  const block = editor.testBlock(channel);
  const pending = state?.status === 'pending';
  const button = (
    <Button
      disabled={block !== null}
      loading={pending}
      size="small"
      onClick={() => void editor.test(channel)}
    >
      {t('system.alerts.test.action')}
    </Button>
  );
  const blockHint =
    block === 'unavailable'
      ? unavailable?.reason
      : block === 'storedOff'
        ? t('system.alerts.test.saveFirst')
        : block === 'unsaved'
          ? t('system.alerts.test.unsaved')
          : undefined;

  return (
    <div className={styles.inlineRow}>
      {blockHint && !editor.saving ? (
        <Tooltip title={blockHint}>
          <span>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      {state?.status === 'done' ? (
        state.result.ok ? (
          <span className={styles.testSucceeded} role="status">
            {t('system.alerts.test.success', { count: state.result.delivered })}
          </span>
        ) : (
          <span className={styles.testFailed} role="status">
            {state.result.error
              ? t('system.alerts.test.failed', { error: state.result.error })
              : t('system.alerts.test.failedUnknown')}
          </span>
        )
      ) : null}
    </div>
  );
});

ChannelTest.displayName = 'AdminSystemAlertChannelTest';

export interface ChannelBlockProps {
  channel: AdminStatusAlertChannel;
  children: ReactNode;
  disabled: boolean;
  editor: AlertSettingsEditor;
  enabled: boolean;
  /** Show the channel's fields even while it is switched off (e.g. stored credentials to clear). */
  expanded?: boolean;
  help?: string;
  /** One of the channel's fields blocks the save — outline the whole block. */
  invalid?: boolean;
  label: string;
  onToggle: (enabled: boolean) => void;
  unavailable?: ChannelUnavailable;
}

export const ChannelBlock = memo<ChannelBlockProps>(
  ({
    channel,
    children,
    disabled,
    editor,
    enabled,
    expanded,
    help,
    invalid,
    label,
    onToggle,
    unavailable,
  }) => {
    const { t } = useTranslation('admin');
    const switchId = `alert-channel-${useId()}`;

    return (
      <Block
        className={invalid ? styles.channelInvalid : undefined}
        data-invalid={invalid ? 'true' : undefined}
        data-testid={`alert-channel-${channel}`}
        padding={12}
        variant="outlined"
      >
        <div className={styles.channelHeader}>
          <span className={styles.channelTitle}>
            <label htmlFor={switchId}>{label}</label>
            {help ? <InfraHelpButton hint={help} label={label} /> : null}
          </span>
          {/* An unavailable channel can still be switched off, never on. */}
          <Switch
            checked={enabled}
            disabled={disabled || (Boolean(unavailable) && !enabled)}
            id={switchId}
            onChange={onToggle}
          />
        </div>
        {unavailable ? (
          <div className={styles.unavailable}>
            {unavailable.reason}{' '}
            <Link to={unavailable.to}>{t('system.alerts.channels.configure')}</Link>
          </div>
        ) : null}
        {enabled || expanded ? (
          <div className={styles.channelBody}>
            {children}
            <ChannelTest channel={channel} editor={editor} unavailable={unavailable} />
          </div>
        ) : null}
      </Block>
    );
  },
);

ChannelBlock.displayName = 'AdminSystemAlertChannelBlock';
