'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, CheckboxGroup, Input, Select, SkeletonText, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Building2 } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  AdminEnterpriseLookupSettingsService,
  AdminSystemEnterpriseLookupProbeResult,
  AdminSystemEnterpriseLookupSettings,
} from '@/enterprise/client/services/adminSystem';
import { adminSystemService } from '@/enterprise/client/services/adminSystem';
import { useClientDataSWR } from '@/libs/swr';
import {
  ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX,
  type EnterpriseLookupProvider,
  QCC_CATEGORIES,
  type QccCategory,
} from '@/types/platform/enterpriseLookup';

import { InfraSettingsCard } from '../InfraSettingsCard';
import { buildAdminEnterpriseLookupSettingsKey } from '../swrKeys';
import { InfraEditorActions, InfraEditorAlerts } from './editorChrome';
import {
  enterpriseLookupDefaultProviderOptions,
  formatEnterpriseLookupTime,
  resolveEnterpriseLookupProbeKey,
} from './enterpriseLookupDraft';
import { useInfraValueFormatters } from './format';
import { InfraField, InfraSwitchRow } from './InfraField';
import { SecretField } from './SecretField';
import { infraFormStyles as formStyles } from './styles';
import {
  type EnterpriseLookupEditor,
  useEnterpriseLookupEditor,
} from './useEnterpriseLookupEditor';
import { useInfraEditModal } from './useInfraEditModal';

const styles = createStaticStyles(({ css }) => ({
  /** Tool count and other machine readings: tabular, so two probes compare at a glance. */
  code: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
  `,
  /** One provider per block, divided by a hairline so the two credentials never blur together. */
  section: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    min-width: 0;
    padding-block-start: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  /** The provider name, and the probe that answers for it, on one line. */
  sectionHeader: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  sectionTitle: css`
    font-size: 13px;
    font-weight: 600;
    line-height: 20px;
    color: ${cssVar.colorText};
  `,
}));

export interface EnterpriseLookupCardProps {
  /** SYSTEM_OPERATE. Without it the card shows the same readings and offers no 编辑. */
  canOperate: boolean;
  /** False while the tab cannot be read, so the card never asks for a configuration it cannot show. */
  enabled?: boolean;
  /** Injectable for tests. */
  service?: AdminEnterpriseLookupSettingsService;
}

/** The outcome of the last probe for one provider, in one line. */
const EnterpriseLookupProbeResult = memo<{ probe?: AdminSystemEnterpriseLookupProbeResult }>(
  ({ probe }) => {
    const { t } = useTranslation('admin');
    if (!probe) return null;

    return (
      <Flexbox gap={4}>
        <Text type={probe.ok ? 'success' : 'danger'}>
          {t(resolveEnterpriseLookupProbeKey(probe) as never)}
        </Text>
        {probe.ok && probe.toolCount !== undefined ? (
          <Text className={styles.code} type="secondary">
            {t('systemGeneral.enterpriseLookup.test.toolCount', { count: probe.toolCount })}
          </Text>
        ) : null}
      </Flexbox>
    );
  },
);

EnterpriseLookupProbeResult.displayName = 'AdminEnterpriseLookupProbeResult';

/** 启用 switch, credential and probe — what both providers have in common. */
const ProviderSection = memo<{
  canOperate: boolean;
  children?: ReactNode;
  disabled: boolean;
  editor: EnterpriseLookupEditor;
  provider: EnterpriseLookupProvider;
}>(({ canOperate, children, disabled, editor, provider }) => {
  const { t } = useTranslation('admin');
  const qcc = provider === 'qcc';
  const enabled = qcc ? editor.draft.qccEnabled : editor.draft.tianyanchaEnabled;
  const secret = qcc ? editor.draft.qccApiKey : editor.draft.tianyanchaApiKey;
  const error = editor.errors[qcc ? 'qccApiKey' : 'tianyanchaApiKey'];

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>
          {t(`systemGeneral.enterpriseLookup.provider.${provider}` as never)}
        </span>
        {canOperate ? (
          <Button
            disabled={disabled}
            loading={Boolean(editor.probing[provider])}
            size="small"
            onClick={() => void editor.test(provider)}
          >
            {t('systemGeneral.testConnection')}
          </Button>
        ) : null}
      </div>

      <InfraSwitchRow
        checked={enabled}
        disabled={disabled}
        hint={t(`systemGeneral.enterpriseLookup.hints.${provider}Enabled` as never)}
        label={t('systemGeneral.enterpriseLookup.fields.enabled')}
        onChange={(checked) =>
          editor.patch(qcc ? { qccEnabled: checked } : { tianyanchaEnabled: checked })
        }
      />

      <SecretField
        wide
        disabled={disabled}
        error={error}
        hint={t('systemGeneral.enterpriseLookup.hints.apiKey')}
        label={t('systemGeneral.enterpriseLookup.fields.apiKey')}
        value={secret}
        onChange={(next) => editor.patch(qcc ? { qccApiKey: next } : { tianyanchaApiKey: next })}
      />

      {children}

      <EnterpriseLookupProbeResult probe={editor.probes[provider]} />
    </div>
  );
});

ProviderSection.displayName = 'AdminEnterpriseLookupProviderSection';

const EnterpriseLookupForm = memo<{
  canOperate: boolean;
  disabled: boolean;
  editor: EnterpriseLookupEditor;
}>(({ canOperate, disabled, editor }) => {
  const { t } = useTranslation('admin');
  const { draft, errors, patch } = editor;

  const categoryOptions = useMemo(
    () =>
      QCC_CATEGORIES.map((category) => ({
        label: t(`systemGeneral.enterpriseLookup.categories.${category}` as never),
        value: category,
      })),
    [t],
  );

  /** Only enabled providers: a default the platform will never call is a setting that lies. */
  const defaultProviderOptions = useMemo(
    () =>
      enterpriseLookupDefaultProviderOptions(draft).map((provider) => ({
        label: t(`systemGeneral.enterpriseLookup.provider.${provider}` as never),
        value: provider,
      })),
    [draft, t],
  );

  return (
    <div className={formStyles.stack}>
      <span className={formStyles.hint}>{t('systemGeneral.enterpriseLookup.editHint')}</span>

      <ProviderSection canOperate={canOperate} disabled={disabled} editor={editor} provider="qcc">
        <InfraField
          wide
          error={errors.qccCategories}
          hint={t('systemGeneral.enterpriseLookup.hints.categories')}
          label={t('systemGeneral.enterpriseLookup.fields.categories')}
          note={t('systemGeneral.enterpriseLookup.hints.verifiedCategories')}
        >
          {(field) => (
            <div aria-labelledby={field.labelId} role="group">
              <CheckboxGroup
                horizontal
                disabled={disabled || !draft.qccEnabled}
                gap={12}
                options={categoryOptions}
                value={draft.qccCategories}
                onChange={(next) => patch({ qccCategories: next as QccCategory[] })}
              />
            </div>
          )}
        </InfraField>
      </ProviderSection>

      <ProviderSection
        canOperate={canOperate}
        disabled={disabled}
        editor={editor}
        provider="tianyancha"
      />

      <div className={styles.section}>
        <span className={styles.sectionTitle}>
          {t('systemGeneral.enterpriseLookup.sections.routing')}
        </span>
        <div className={formStyles.fieldGrid}>
          <InfraField
            error={errors.defaultProvider}
            hint={t('systemGeneral.enterpriseLookup.hints.defaultProvider')}
            label={t('systemGeneral.enterpriseLookup.fields.defaultProvider')}
          >
            {(field) =>
              defaultProviderOptions.length === 0 ? (
                // Nothing is enabled, so there is nothing to route to — say so rather than
                // offer an empty menu.
                <span className={formStyles.hint}>
                  {t('systemGeneral.enterpriseLookup.noProviderEnabled')}
                </span>
              ) : (
                <Select
                  {...field.control}
                  disabled={disabled}
                  options={defaultProviderOptions}
                  value={draft.defaultProvider}
                  onChange={(next) => patch({ defaultProvider: next as EnterpriseLookupProvider })}
                />
              )
            }
          </InfraField>
          <InfraField
            error={errors.dailyLimitPerUser}
            label={t('systemGeneral.enterpriseLookup.fields.dailyLimit')}
            hint={t('systemGeneral.enterpriseLookup.hints.dailyLimit', {
              max: ENTERPRISE_LOOKUP_DAILY_LIMIT_MAX,
            })}
          >
            {(field) => (
              <Input
                {...field.control}
                disabled={disabled}
                inputMode="numeric"
                value={draft.dailyLimitPerUser}
                onChange={(event) => patch({ dailyLimitPerUser: event.target.value })}
              />
            )}
          </InfraField>
        </div>
        <InfraSwitchRow
          checked={draft.fallbackEnabled}
          disabled={disabled}
          hint={t('systemGeneral.enterpriseLookup.hints.fallback')}
          label={t('systemGeneral.enterpriseLookup.fields.fallback')}
          onChange={(checked) => patch({ fallbackEnabled: checked })}
        />
      </div>
    </div>
  );
});

EnterpriseLookupForm.displayName = 'AdminEnterpriseLookupForm';

const EnterpriseLookupCardBody = memo<{
  canOperate: boolean;
  service?: AdminEnterpriseLookupSettingsService;
  view: AdminSystemEnterpriseLookupSettings;
}>(({ canOperate, service, view }) => {
  const { t } = useTranslation('admin');
  const { unset, yesNo } = useInfraValueFormatters();
  const editor = useEnterpriseLookupEditor({ canOperate, service, view });
  const editModal = useInfraEditModal({
    beginEdit: editor.beginEdit,
    cancelEdit: editor.cancelEdit,
    dirty: editor.dirty,
    saveCount: editor.saveCount,
  });
  const locked = editor.conflict || editor.stale;

  /**
   * One row per provider: whether the platform will call it, and which credential it holds.
   *
   * The digest is what makes a rotation verifiable — an admin who pasted a new key can see that the
   * stored one changed, without the server ever echoing either of them.
   */
  const providerValue = (provider: {
    apiKeyFingerprint?: string;
    apiKeyStored: boolean;
    enabled: boolean;
  }): string => {
    if (!provider.enabled) return t('systemGeneral.enterpriseLookup.values.disabled');
    if (!provider.apiKeyStored) return t('systemGeneral.enterpriseLookup.values.enabledNoKey');
    return provider.apiKeyFingerprint
      ? t('systemGeneral.enterpriseLookup.values.enabledWithKey', {
          fingerprint: provider.apiKeyFingerprint,
        })
      : t('systemGeneral.enterpriseLookup.values.enabled');
  };

  const anyProviderEnabled = view.config.qcc.enabled || view.config.tianyancha.enabled;

  const summaryFields = [
    {
      label: t('systemGeneral.enterpriseLookup.fields.status'),
      value: t(
        view.status === 'configured'
          ? 'systemGeneral.status.configured'
          : 'systemGeneral.status.notConfigured',
      ),
    },
    {
      label: t('systemGeneral.enterpriseLookup.fields.defaultProvider'),
      // With nothing enabled the stored default routes nothing; claiming one would be misleading.
      value: anyProviderEnabled
        ? t(`systemGeneral.enterpriseLookup.provider.${view.config.defaultProvider}` as never)
        : t('systemGeneral.values.unset'),
    },
    {
      label: t('systemGeneral.enterpriseLookup.provider.qcc'),
      value: providerValue(view.config.qcc),
    },
    {
      label: t('systemGeneral.enterpriseLookup.provider.tianyancha'),
      value: providerValue(view.config.tianyancha),
    },
    {
      label: t('systemGeneral.enterpriseLookup.fields.dailyLimit'),
      value:
        view.config.dailyLimitPerUser === 0
          ? t('systemGeneral.enterpriseLookup.values.unlimited')
          : t('systemGeneral.enterpriseLookup.values.perDay', {
              count: view.config.dailyLimitPerUser,
            }),
    },
  ];

  /** 详情 adds what only matters once the providers are set up. */
  const detailsFields = [
    ...summaryFields,
    {
      label: t('systemGeneral.enterpriseLookup.fields.categories'),
      value:
        view.config.qcc.categories.length === 0
          ? t('systemGeneral.values.unset')
          : QCC_CATEGORIES.filter((category) => view.config.qcc.categories.includes(category))
              .map((category) =>
                t(`systemGeneral.enterpriseLookup.categories.${category}` as never),
              )
              .join('、'),
    },
    {
      label: t('systemGeneral.enterpriseLookup.fields.fallback'),
      value: yesNo(view.config.fallbackEnabled),
    },
    {
      label: t('systemGeneral.enterpriseLookup.fields.updatedAt'),
      value: unset(formatEnterpriseLookupTime(view.updatedAt)),
    },
  ];

  return (
    <InfraSettingsCard
      canTest={false}
      detailsFields={detailsFields}
      editOpen={editModal.open}
      fields={summaryFields}
      icon={Building2}
      notice={<Text type="secondary">{t('systemGeneral.enterpriseLookup.description')}</Text>}
      probing={false}
      status={view.status === 'configured' ? 'unknown' : 'disabled'}
      title={t('systemGeneral.enterpriseLookup.title')}
      editActions={
        canOperate ? (
          <InfraEditorActions
            canCancel
            canRevert={false}
            dirty={editor.dirty}
            invalid={editor.invalid}
            locked={locked}
            saving={editor.saving}
            source="db"
            onCancel={editModal.requestClose}
            onRevert={() => undefined}
            onSave={() => void editor.save()}
          />
        ) : undefined
      }
      editor={
        canOperate ? (
          <div className={formStyles.stack}>
            <InfraEditorAlerts
              conflict={editor.conflict}
              stale={editor.stale}
              onReload={() => void editor.reload()}
            />
            <EnterpriseLookupForm
              canOperate={canOperate}
              disabled={editor.saving || locked}
              editor={editor}
            />
            <span className={formStyles.hint}>{t('systemGeneral.edit.applyHint')}</span>
          </div>
        ) : undefined
      }
      onEditOpenChange={editModal.onOpenChange}
      onTest={() => undefined}
    />
  );
});

EnterpriseLookupCardBody.displayName = 'AdminEnterpriseLookupCardBody';

/**
 * 企业查询 card — 企查查 / 天眼查 credentials, the category scope and the per-user daily cap.
 *
 * It owns its own request rather than riding the shared 基础设施 snapshot: this row is written from
 * this card alone, so one save has no reason to invalidate the readings of the cards beside it. The
 * environment never configures this dependency, so there is no 来源 tag and no way back to it —
 * switching the feature off means disabling both providers.
 */
export const EnterpriseLookupCard = memo<EnterpriseLookupCardProps>(
  ({ canOperate, enabled = true, service = adminSystemService }) => {
    const { t } = useTranslation('admin');
    const { data, error, mutate } = useClientDataSWR(
      buildAdminEnterpriseLookupSettingsKey(enabled),
      () => service.getEnterpriseLookupSettings(),
      { keepPreviousData: true, revalidateOnFocus: false },
    );

    if (data) {
      return <EnterpriseLookupCardBody canOperate={canOperate} service={service} view={data} />;
    }

    /**
     * Still a full-height card while there is no reading: the grid gives every card the height of
     * the tallest one in its row, so a card that disappears takes its neighbours with it.
     */
    if (error) {
      return (
        <InfraSettingsCard
          canTest={false}
          icon={Building2}
          notice={<Text type="danger">{t('systemGeneral.loadFailed')}</Text>}
          probing={false}
          title={t('systemGeneral.enterpriseLookup.title')}
          extraActions={
            <Button size="small" onClick={() => void mutate()}>
              {t('systemGeneral.retry')}
            </Button>
          }
          onTest={() => undefined}
        />
      );
    }

    return (
      <InfraSettingsCard
        canTest={false}
        icon={Building2}
        probing={false}
        summary={<SkeletonText rows={4} />}
        title={t('systemGeneral.enterpriseLookup.title')}
        onTest={() => undefined}
      />
    );
  },
);

EnterpriseLookupCard.displayName = 'AdminEnterpriseLookupCard';
