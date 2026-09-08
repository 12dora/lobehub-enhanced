import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { Flexbox, Icon, Select, SliderWithInput, TextArea } from '@lobehub/ui';
import { Form as AntdForm, Switch } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { debounce } from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PartialDeep } from 'type-fest';

import InfoTooltip from '@/components/InfoTooltip';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import ControlsForm from '@/features/ModelSwitchPanel/components/ControlsForm';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/selectors';
import type { LobeAgentChatConfig, LobeAgentConfig } from '@/types/agent';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

interface ControlsProps {
  setUpdating: (updating: boolean) => void;
  updating: boolean;
  variant?: 'popover' | 'sidebar';
}

/**
 * The only two sections this panel may write. Anything else the form holds (`slug`, `systemRole`,
 * `title`, `avatar`, …) belongs to the agent's identity: on the platform-managed default inbox the
 * server rejects a patch that merely mentions such a field (`MANAGED_RESOURCE_BY_PLATFORM`), so a
 * whole-form submit turned every temperature or history-limit tweak into an error toast.
 * `params` merges key by key both optimistically and in the database, so one key is enough.
 */
interface AgentConfigPatch {
  chatConfig?: Partial<LobeAgentChatConfig>;
  /** `null` is the disabled marker the database preserves and the switches read back. */
  params?: Record<string, null | number | string>;
}

type ParamKey = 'temperature' | 'top_p' | 'presence_penalty' | 'frequency_penalty';

type ParamLabelKey =
  | 'settingModel.params.panel.creativity'
  | 'settingModel.params.panel.openness'
  | 'settingModel.params.panel.topicDivergence'
  | 'settingModel.params.panel.vocabularyRichness';

type ParamDescKey =
  | 'settingModel.frequencyPenalty.desc'
  | 'settingModel.presencePenalty.desc'
  | 'settingModel.temperature.desc'
  | 'settingModel.topP.desc';

interface SliderConfig {
  max: number;
  min: number;
  step: number;
  unlimitedInput?: boolean;
}

const styles = createStaticStyles(({ css }) => ({
  advancedContent: css`
    display: flex;
    flex-direction: column;

    .control-row {
      border-block-start: 1px solid ${cssVar.colorSplit};
    }

    .control-row:first-child {
      border-block-start: none;
    }
  `,
  sectionHeader: css`
    cursor: pointer;

    width: calc(100% + 16px);
    margin-inline: -8px;
    padding-block: 12px;
    padding-inline: 8px;
    border: none;
    border-radius: 10px;

    font: inherit;
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
    text-align: start;

    background: transparent;

    transition: color 0.2s ease;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:hover .section-header-label {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      outline: 1px solid ${cssVar.colorBorder};
      outline-offset: 2px;
    }
  `,
  body: css`
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;

    min-height: 0;
    padding-block-end: 4px;
    padding-inline: 12px;
  `,
  commonSection: css`
    display: flex;
    flex-direction: column;
    padding-block: 0;
  `,
  divider: css`
    height: 1px;
    background: ${cssVar.colorSplit};
  `,
  hint: css`
    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
  /** Replaces the model-params section when the admin owns those fields. */
  managedHint: css`
    padding-block: 12px;
  `,
  form: css`
    margin: 0;
  `,
  formSidebar: css`
    display: flex;
    flex: 1;

    width: 100%;
    height: 100%;
    min-height: 0;
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block: 16px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorSplit};

    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  headerLoading: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;

    color: ${cssVar.colorTextTertiary};
  `,
  headerTitle: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  label: css`
    user-select: none;

    min-width: 0;

    font-size: 13px;
    font-weight: 500;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};
  `,
  labelMain: css`
    flex-wrap: wrap;
    min-width: 0;
  `,
  muted: css`
    .control-label {
      color: ${cssVar.colorTextTertiary};
    }
  `,
  modelConfigSection: css`
    padding-block: 12px;

    .ant-form {
      margin: 0;
    }

    .ant-form-item {
      padding-block: 12px;
    }

    .ant-form-item-row {
      gap: 10px;
    }

    .ant-form-item-label > label {
      font-size: 13px;
      font-weight: 500;
      line-height: 20px;
      color: ${cssVar.colorTextSecondary};
    }

    .ant-form-item-label > label div {
      color: ${cssVar.colorTextSecondary};
    }

    .ant-form-item-label > label small,
    .ant-form-item-label > label small *:not(a) {
      font-size: 12px;
      font-weight: 400;
      line-height: 18px;
      color: ${cssVar.colorTextTertiary};
    }

    .ant-form-item:first-child {
      padding-block-start: 0;
    }

    .ant-form-item:last-child {
      padding-block-end: 0;
    }

    .ant-divider {
      display: none;
    }
  `,
  panel: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: min(384px, 100%);
    max-height: 50vh;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};

    .ant-switch {
      min-width: 28px;
      background: ${cssVar.colorFillSecondary};
    }

    .ant-switch .ant-switch-handle::before {
      background: ${cssVar.colorBgElevated};
    }

    .ant-switch.ant-switch-checked {
      background: ${cssVar.colorText};
    }

    .ant-form-item {
      margin: 0;
    }
  `,
  sidebarPanel: css`
    width: 100%;
    height: 100%;
    max-height: none;
    border: none;
    border-radius: 0;

    background: transparent;
    box-shadow: none;
  `,
  rowControl: css`
    width: 100%;
  `,
  rowRoot: css`
    padding-block: 12px;
  `,
  tag: css`
    user-select: none;

    align-self: flex-start;

    width: fit-content;
    padding-block: 2px;
    padding-inline: 7px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    font-weight: 500;
    line-height: 1.2;
    color: ${cssVar.colorTextQuaternary};

    background: ${cssVar.colorFillQuaternary};
  `,
  tooltipContent: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 240px;
  `,
  slider: css`
    width: 100%;

    .ant-slider {
      margin-block: 0;
      margin-inline: 0;
    }

    .ant-slider-rail {
      background: ${cssVar.colorFillQuaternary};
    }

    .ant-slider-track {
      background: ${cssVar.colorTextSecondary};
    }

    .ant-slider-handle::after {
      background: ${cssVar.colorBgElevated};
      box-shadow: 0 0 0 2px ${cssVar.colorTextSecondary};
    }

    .ant-slider-handle:hover::after,
    .ant-slider-handle:focus::after,
    .ant-slider-handle:active::after {
      box-shadow: 0 0 0 3px ${cssVar.colorTextSecondary};
    }

    .ant-input-number,
    .ant-input-number-affix-wrapper {
      overflow: hidden;

      height: 28px;
      border: none;
      border-radius: 10px;

      color: ${cssVar.colorTextSecondary};

      background: ${cssVar.colorFillTertiary};
      box-shadow: none;
    }

    .ant-input-number:hover,
    .ant-input-number-focused,
    .ant-input-number-affix-wrapper:hover,
    .ant-input-number-affix-wrapper-focused {
      background: ${cssVar.colorFillSecondary};
      box-shadow: none;
    }

    .ant-input-number-input {
      height: 28px;
      padding-inline: 6px;

      font-size: 13px;
      color: ${cssVar.colorTextSecondary};
      text-align: center;
    }
  `,
}));

const PARAM_NAME_MAP: Record<ParamKey, (string | number)[]> = {
  frequency_penalty: ['params', 'frequency_penalty'],
  presence_penalty: ['params', 'presence_penalty'],
  temperature: ['params', 'temperature'],
  top_p: ['params', 'top_p'],
};

const PARAM_DEFAULTS: Record<ParamKey, number> = {
  frequency_penalty: 0,
  presence_penalty: 0,
  temperature: 0.7,
  top_p: 1,
};

const PARAM_CONFIG = {
  frequency_penalty: {
    descKey: 'settingModel.frequencyPenalty.desc',
    labelKey: 'settingModel.params.panel.vocabularyRichness',
    slider: { max: 2, min: -2, step: 0.1 },
    tag: 'frequency_penalty',
  },
  presence_penalty: {
    descKey: 'settingModel.presencePenalty.desc',
    labelKey: 'settingModel.params.panel.topicDivergence',
    slider: { max: 2, min: -2, step: 0.1 },
    tag: 'presence_penalty',
  },
  temperature: {
    descKey: 'settingModel.temperature.desc',
    labelKey: 'settingModel.params.panel.creativity',
    slider: { max: 2, min: 0, step: 0.1 },
    tag: 'temperature',
  },
  top_p: {
    descKey: 'settingModel.topP.desc',
    labelKey: 'settingModel.params.panel.openness',
    slider: { max: 1, min: 0, step: 0.1 },
    tag: 'top_p',
  },
} satisfies Record<
  ParamKey,
  {
    descKey: ParamDescKey;
    labelKey: ParamLabelKey;
    slider: SliderConfig;
    tag: string;
  }
>;

const PARAM_ORDER: ParamKey[] = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'];

const ADVANCED_OPEN_STORAGE_KEY = 'lobehub-chat-input-params-advanced-open';
const MODEL_CONFIG_OPEN_STORAGE_KEY = 'lobehub-chat-input-params-model-config-open';

const getStoredOpen = (storageKey: string) => {
  if (typeof window === 'undefined') return false;

  return window.localStorage.getItem(storageKey) === 'true';
};

const setStoredOpen = (storageKey: string, open: boolean) => {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(storageKey, String(open));
};

interface ControlLabelProps {
  tag?: string;
  title: string;
  tooltip?: string;
}

const ControlLabel = memo<ControlLabelProps>(({ title, tooltip, tag }) => (
  <Flexbox align={'flex-start'} className={cx(styles.label, 'control-label')} gap={6}>
    <Flexbox horizontal align={'center'} className={styles.labelMain} gap={6}>
      {title}
      {tooltip && (
        <InfoTooltip
          title={
            <div className={styles.tooltipContent}>
              {tag && <span className={styles.tag}>{tag}</span>}
              <span>{tooltip}</span>
            </div>
          }
        />
      )}
    </Flexbox>
  </Flexbox>
));

interface ControlRowProps {
  action?: ReactNode;
  children?: ReactNode;
  muted?: boolean;
  tag?: string;
  title: string;
  tooltip?: string;
}

const ControlRow = memo<ControlRowProps>(({ action, children, muted, tag, title, tooltip }) => (
  <Flexbox className={cx('control-row', styles.rowRoot, muted && styles.muted)} gap={10}>
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <ControlLabel tag={tag} title={title} tooltip={tooltip} />
      {action}
    </Flexbox>
    {children && <div className={styles.rowControl}>{children}</div>}
  </Flexbox>
));

interface SectionHeaderProps {
  onToggle: () => void;
  open: boolean;
  title: string;
}

const SectionHeader = memo<SectionHeaderProps>(({ onToggle, open, title }) => (
  <button aria-expanded={open} className={styles.sectionHeader} type="button" onClick={onToggle}>
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <span className={cx(styles.label, 'section-header-label')}>{title}</span>
      <Icon icon={open ? ChevronUp : ChevronDown} size={18} />
    </Flexbox>
  </button>
));

interface SliderFieldProps extends SliderConfig {
  disabled?: boolean;
  inputWidth?: number;
  onChange: (value: number) => void;
  value?: number;
}

const SliderField = memo<SliderFieldProps>(
  ({ value, disabled, onChange, min, max, step, unlimitedInput, inputWidth = 56 }) => (
    <SliderWithInput
      changeOnWheel
      className={styles.slider}
      controls={false}
      disabled={disabled}
      gap={10}
      max={max}
      min={min}
      size={'small'}
      step={step}
      style={{ height: 28 }}
      unlimitedInput={unlimitedInput}
      value={value}
      styles={{
        input: {
          maxWidth: inputWidth,
        },
      }}
      onChange={onChange}
    />
  ),
);

const Controls = memo<ControlsProps>(({ setUpdating, updating, variant = 'popover' }) => {
  // The managed-params hint lives in the `chat` namespace, shared with the model pill.
  const { t } = useTranslation(['setting', 'components', 'chat']);
  const agentId = useAgentId();
  const { updateAgentChatConfig, updateAgentConfig } = useUpdateAgentConfig();
  const { allowed: canCreate } = usePermission('create_content');

  const config = useAgentStore(
    (s) => agentByIdSelectors.getAgentConfigById(agentId)(s) || DEFAULT_AGENT_CONFIG,
    isEqual,
  );
  const agentModel = useAgentStore((s) => agentByIdSelectors.getAgentModelById(agentId)(s));
  const agentProvider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
  );
  const enableAgentMode = useAgentStore(agentByIdSelectors.getAgentEnableModeById(agentId));
  /**
   * Admin-PINNED on a managed agent (`platform.modelLocked !== false`): `params` (temperature,
   * top_p, penalties, max_tokens, reasoning_effort) is overlaid on every read and rejected on
   * write. Every other control on this panel writes `chatConfig`, which stays the user's own, so
   * only the params section is withheld. A managed agent whose platform version merely supplies
   * defaults (`modelLocked: false`) keeps the full panel.
   */
  const isModelLocked = useAgentStore(agentByIdSelectors.isAgentModelLockedById(agentId));
  const hasModelConfig = useAiInfraStore(
    aiModelSelectors.isModelHasExtendParams(agentModel ?? '', agentProvider ?? ''),
  );
  const [form] = AntdForm.useForm();
  const [advancedOpen, setAdvancedOpen] = useState(() => getStoredOpen(ADVANCED_OPEN_STORAGE_KEY));
  const [modelConfigOpen, setModelConfigOpen] = useState(() =>
    getStoredOpen(MODEL_CONFIG_OPEN_STORAGE_KEY),
  );
  const [, refreshFormValues] = useState(0);

  const enableContextCompression = form.getFieldValue(['chatConfig', 'enableContextCompression']);
  const enableMaxTokens = form.getFieldValue(['chatConfig', 'enableMaxTokens']);
  const enableHistoryCount = form.getFieldValue(['chatConfig', 'enableHistoryCount']);
  const historyCountValue = form.getFieldValue(['chatConfig', 'historyCount']);
  const maxTokensValue = form.getFieldValue(['params', 'max_tokens']);
  const inputTemplateValue = form.getFieldValue(['chatConfig', 'inputTemplate']);
  const enableAutoScrollOnStreaming = form.getFieldValue([
    'chatConfig',
    'enableAutoScrollOnStreaming',
  ]);
  const enableStreaming = form.getFieldValue(['chatConfig', 'enableStreaming']);
  const enableFollowUpChips = form.getFieldValue(['chatConfig', 'enableFollowUpChips']);
  const globalFollowUp = useUserStore(systemAgentSelectors.followUpAction, isEqual);
  const globalFollowUpReady =
    globalFollowUp.enabled === true && !!globalFollowUp.model && !!globalFollowUp.provider;
  const showFollowUpHint = !globalFollowUpReady && Boolean(enableFollowUpChips);
  const enableReasoningEffort = form.getFieldValue(['chatConfig', 'enableReasoningEffort']);
  const reasoningEffortValue = form.getFieldValue(['params', 'reasoning_effort']);
  const disabledParams = useAiInfraStore(
    aiModelSelectors.modelDisabledParams(agentModel ?? '', agentProvider ?? ''),
  );
  const { frequency_penalty, presence_penalty, temperature, top_p } = config.params ?? {};

  const historyCountFromStore = useAgentStore((s) =>
    chatConfigByIdSelectors.getHistoryCountById(agentId)(s),
  );
  // Use raw chatConfig value, not the selector with business logic that may force false
  const enableHistoryCountFromStore = useAgentStore(
    (s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s).enableHistoryCount,
  );

  const lastValuesRef = useRef<Record<ParamKey, number | undefined>>({
    frequency_penalty,
    presence_penalty,
    temperature,
    top_p,
  });

  useEffect(() => {
    form.setFieldsValue(config);

    if (typeof temperature === 'number') lastValuesRef.current.temperature = temperature;
    if (typeof top_p === 'number') lastValuesRef.current.top_p = top_p;
    if (typeof presence_penalty === 'number') {
      lastValuesRef.current.presence_penalty = presence_penalty;
    }
    if (typeof frequency_penalty === 'number') {
      lastValuesRef.current.frequency_penalty = frequency_penalty;
    }
    refreshFormValues((value) => value + 1);
  }, [config, form, frequency_penalty, presence_penalty, temperature, top_p]);

  // Sync history count values to form
  useEffect(() => {
    // Skip syncing when updating to avoid overwriting user's in-progress edits
    if (updating) return;

    form.setFieldsValue({
      chatConfig: {
        ...form.getFieldValue('chatConfig'),
        enableHistoryCount: enableHistoryCountFromStore,
        historyCount: historyCountFromStore,
      },
    });
    refreshFormValues((value) => value + 1);
  }, [form, enableHistoryCountFromStore, historyCountFromStore, updating]);

  const temperatureValue = form.getFieldValue(PARAM_NAME_MAP.temperature);
  const topPValue = form.getFieldValue(PARAM_NAME_MAP.top_p);
  const presencePenaltyValue = form.getFieldValue(PARAM_NAME_MAP.presence_penalty);
  const frequencyPenaltyValue = form.getFieldValue(PARAM_NAME_MAP.frequency_penalty);

  const enabledMap: Record<ParamKey, boolean> = {
    frequency_penalty: typeof frequencyPenaltyValue === 'number',
    presence_penalty: typeof presencePenaltyValue === 'number',
    temperature: typeof temperatureValue === 'number',
    top_p: typeof topPValue === 'number',
  };
  const panelTitle = enableAgentMode
    ? t('settingModel.params.panel.agentTitle')
    : t('settingModel.params.panel.title');

  /**
   * Edits queue up here between flushes so the 500 ms debounce that smooths slider drags cannot
   * drop a distinct field the user changed just before it (only the whole-form submit used to
   * make that safe).
   */
  const pendingPatchRef = useRef<AgentConfigPatch>({});
  /** Every updater shares one abort controller, so patches must be sent one after another. */
  const inflightRef = useRef<Promise<void>>(Promise.resolve());

  const flushPatch = useCallback(async () => {
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};

    const params = patch.params && Object.keys(patch.params).length > 0 ? patch.params : undefined;
    const chatConfig =
      patch.chatConfig && Object.keys(patch.chatConfig).length > 0 ? patch.chatConfig : undefined;
    if (!params && !chatConfig) return;

    setUpdating(true);
    try {
      if (chatConfig && !params) {
        await updateAgentChatConfig(chatConfig);
      } else {
        await updateAgentConfig({
          ...(chatConfig && { chatConfig }),
          ...(params && { params: params as LobeAgentConfig['params'] }),
        } as PartialDeep<LobeAgentConfig>);
      }
    } finally {
      setUpdating(false);
    }
  }, [setUpdating, updateAgentChatConfig, updateAgentConfig]);

  const runFlush = useCallback(() => {
    const next = inflightRef.current.then(flushPatch).catch(() => {});
    inflightRef.current = next;
    return next;
  }, [flushPatch]);

  const debouncedFlush = useMemo(
    () =>
      debounce(() => {
        void runFlush();
      }, 500),
    [runFlush],
  );

  const submitPatch = useCallback(
    (patch: AgentConfigPatch, options?: { immediate?: boolean }): Promise<void> => {
      const pending = pendingPatchRef.current;
      pendingPatchRef.current = {
        ...pending,
        ...(patch.chatConfig && { chatConfig: { ...pending.chatConfig, ...patch.chatConfig } }),
        ...(patch.params && { params: { ...pending.params, ...patch.params } }),
      };

      if (!options?.immediate) {
        debouncedFlush();
        return Promise.resolve();
      }

      debouncedFlush.cancel();
      return runFlush();
    },
    [debouncedFlush, runFlush],
  );

  const handleToggle = useCallback(
    async (key: ParamKey, enabled: boolean) => {
      if (!canCreate) return;
      const namePath = PARAM_NAME_MAP[key];
      let newValue: null | number;

      if (!enabled) {
        const currentValue = form.getFieldValue(namePath);
        if (typeof currentValue === 'number') {
          lastValuesRef.current[key] = currentValue;
        }
        // Use null as a disabled marker (the database preserves null, and the frontend uses it to determine checkbox state)
        newValue = null;
        form.setFieldValue(namePath, undefined);
      } else {
        const fallback = lastValuesRef.current[key];
        const nextValue = typeof fallback === 'number' ? fallback : PARAM_DEFAULTS[key];
        lastValuesRef.current[key] = nextValue;
        newValue = nextValue;
        form.setFieldValue(namePath, nextValue);
      }
      refreshFormValues((value) => value + 1);

      // Save immediately: a switch is a deliberate act, not a drag to smooth out.
      await submitPatch({ params: { [key]: newValue } }, { immediate: true });
    },
    [canCreate, form, refreshFormValues, submitPatch],
  );

  const handleFieldChange = useCallback(
    (
      namePath: (string | number)[],
      value: boolean | number | string,
      extraPatch?: AgentConfigPatch,
    ) => {
      if (!canCreate) return;
      form.setFieldValue(namePath, value);
      if (
        namePath[0] === 'params' &&
        typeof namePath[1] === 'string' &&
        namePath[1] in PARAM_NAME_MAP &&
        typeof value === 'number'
      ) {
        lastValuesRef.current[namePath[1] as ParamKey] = value;
      }
      refreshFormValues((current) => current + 1);

      const [section, key] = namePath;
      if (typeof key !== 'string') return;

      // Only the edited field travels — plus whatever the caller had to seed alongside it
      // (enabling `max_tokens` writes both the switch and the value the slider starts at).
      const patch: AgentConfigPatch = { ...extraPatch };
      if (section === 'params') {
        patch.params = { ...patch.params, [key]: value as number | string };
      } else {
        patch.chatConfig = { ...patch.chatConfig, [key]: value } as Partial<LobeAgentChatConfig>;
      }

      void submitPatch(patch);
    },
    [canCreate, form, refreshFormValues, submitPatch],
  );

  const handleAdvancedOpenChange = useCallback(() => {
    setAdvancedOpen((open) => {
      const nextOpen = !open;
      setStoredOpen(ADVANCED_OPEN_STORAGE_KEY, nextOpen);
      return nextOpen;
    });
  }, []);

  const handleModelConfigOpenChange = useCallback(() => {
    setModelConfigOpen((open) => {
      const nextOpen = !open;
      setStoredOpen(MODEL_CONFIG_OPEN_STORAGE_KEY, nextOpen);
      return nextOpen;
    });
  }, []);

  return (
    <div className={cx(styles.form, variant === 'sidebar' && styles.formSidebar)}>
      <div className={cx(styles.panel, variant === 'sidebar' && styles.sidebarPanel)}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>{panelTitle}</span>
          {updating && (
            <div className={styles.headerLoading}>
              <NeuralNetworkLoading size={18} />
            </div>
          )}
        </div>
        <div className={styles.body}>
          <div className={styles.commonSection}>
            <ControlRow
              tag="compression"
              title={t('settingModel.params.panel.contextCompression')}
              tooltip={t('settingModel.enableContextCompression.desc')}
              action={
                <Switch
                  checked={Boolean(enableContextCompression)}
                  disabled={!canCreate}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange(['chatConfig', 'enableContextCompression'], checked);
                  }}
                />
              }
            />
            <ControlRow
              tag="history"
              title={t('settingModel.params.panel.historyLimit')}
              tooltip={t('settingChat.historyCount.desc')}
              action={
                <Switch
                  checked={Boolean(enableHistoryCount)}
                  disabled={!canCreate}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange(['chatConfig', 'enableHistoryCount'], checked);
                  }}
                />
              }
            >
              {enableHistoryCount && (
                <SliderField
                  unlimitedInput
                  disabled={!canCreate}
                  inputWidth={56}
                  max={20}
                  min={0}
                  step={1}
                  value={typeof historyCountValue === 'number' ? historyCountValue : 0}
                  onChange={(value) => {
                    handleFieldChange(['chatConfig', 'historyCount'], value);
                  }}
                />
              )}
            </ControlRow>
            <ControlRow
              tag="autoScroll"
              title={t('settingChat.enableAutoScrollOnStreaming.title')}
              tooltip={t('settingChat.enableAutoScrollOnStreaming.desc')}
              action={
                <Switch
                  checked={Boolean(enableAutoScrollOnStreaming)}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange(['chatConfig', 'enableAutoScrollOnStreaming'], checked);
                  }}
                />
              }
            />
            <ControlRow
              tag="streaming"
              title={t('settingChat.enableStreaming.title')}
              tooltip={t('settingChat.enableStreaming.desc')}
              action={
                <Switch
                  checked={enableStreaming !== false}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange(['chatConfig', 'enableStreaming'], checked);
                  }}
                />
              }
            />
            <ControlRow
              tag="followUpChips"
              title={t('settingChat.enableFollowUpChips.title')}
              tooltip={t('settingChat.enableFollowUpChips.desc')}
              action={
                <Switch
                  checked={Boolean(enableFollowUpChips)}
                  size={'small'}
                  onChange={(checked) => {
                    handleFieldChange(['chatConfig', 'enableFollowUpChips'], checked);
                  }}
                />
              }
            >
              {showFollowUpHint && (
                <div className={styles.hint}>
                  {t('settingChat.enableFollowUpChips.notConfiguredHint')}
                </div>
              )}
            </ControlRow>
            <ControlRow
              tag="inputTemplate"
              title={t('settingChat.inputTemplate.title')}
              tooltip={t('settingChat.inputTemplate.desc')}
            >
              <TextArea
                placeholder={t('settingChat.inputTemplate.placeholder')}
                value={typeof inputTemplateValue === 'string' ? inputTemplateValue : ''}
                onChange={(e) => {
                  handleFieldChange(['chatConfig', 'inputTemplate'], e.target.value);
                }}
              />
            </ControlRow>
          </div>
          {hasModelConfig && (
            <>
              <div className={styles.divider} />
              <SectionHeader
                open={modelConfigOpen}
                title={t('ModelSwitchPanel.detail.config', { ns: 'components' })}
                onToggle={handleModelConfigOpenChange}
              />
              {modelConfigOpen && (
                <div className={styles.modelConfigSection}>
                  <ControlsForm
                    disabled={!canCreate}
                    model={agentModel}
                    provider={agentProvider}
                    onUpdatingChange={setUpdating}
                  />
                </div>
              )}
            </>
          )}
          {!enableAgentMode && isModelLocked && (
            <>
              <div className={styles.divider} />
              <div className={cx(styles.hint, styles.managedHint)}>
                {t('modelSwitch.managedByAdmin', { ns: 'chat' })}
              </div>
            </>
          )}
          {!enableAgentMode && !isModelLocked && (
            <>
              <div className={styles.divider} />
              <SectionHeader
                open={advancedOpen}
                title={t('settingModel.params.panel.advanced')}
                onToggle={handleAdvancedOpenChange}
              />
              {advancedOpen && (
                <div className={styles.advancedContent}>
                  {PARAM_ORDER.filter((key) => !disabledParams?.includes(key)).map((key) => {
                    const meta = PARAM_CONFIG[key];
                    const enabled = enabledMap[key];

                    return (
                      <ControlRow
                        key={key}
                        muted={!enabled}
                        tag={meta.tag}
                        title={t(meta.labelKey)}
                        tooltip={t(meta.descKey)}
                        action={
                          <Switch
                            checked={enabled}
                            disabled={!canCreate}
                            size={'small'}
                            onChange={(checked) => {
                              handleToggle(key, checked);
                            }}
                          />
                        }
                      >
                        {enabled && (
                          <SliderField
                            disabled={!canCreate}
                            value={form.getFieldValue(PARAM_NAME_MAP[key])}
                            onChange={(value) => {
                              handleFieldChange(PARAM_NAME_MAP[key], value);
                            }}
                            {...meta.slider}
                          />
                        )}
                      </ControlRow>
                    );
                  })}
                  <ControlRow
                    tag="max_tokens"
                    title={t('settingModel.params.panel.responseLength')}
                    tooltip={t('settingModel.maxTokens.desc')}
                    action={
                      <Switch
                        checked={Boolean(enableMaxTokens)}
                        disabled={!canCreate}
                        size={'small'}
                        onChange={(checked) => {
                          const seedMaxTokens = checked && typeof maxTokensValue !== 'number';
                          if (seedMaxTokens) form.setFieldValue(['params', 'max_tokens'], 4096);
                          handleFieldChange(
                            ['chatConfig', 'enableMaxTokens'],
                            checked,
                            seedMaxTokens ? { params: { max_tokens: 4096 } } : undefined,
                          );
                        }}
                      />
                    }
                  >
                    {enableMaxTokens && (
                      <SliderField
                        unlimitedInput
                        disabled={!canCreate}
                        inputWidth={64}
                        max={32_000}
                        min={0}
                        step={100}
                        value={typeof maxTokensValue === 'number' ? maxTokensValue : 4096}
                        onChange={(value) => {
                          handleFieldChange(['params', 'max_tokens'], value);
                        }}
                      />
                    )}
                  </ControlRow>
                  <ControlRow
                    tag="reasoning_effort"
                    title={t('settingModel.reasoningEffort.title')}
                    tooltip={t('settingModel.reasoningEffort.desc')}
                    action={
                      <Switch
                        checked={Boolean(enableReasoningEffort)}
                        size={'small'}
                        onChange={(checked) => {
                          const seedEffort = checked && typeof reasoningEffortValue !== 'string';
                          if (seedEffort) {
                            form.setFieldValue(['params', 'reasoning_effort'], 'medium');
                          }
                          handleFieldChange(
                            ['chatConfig', 'enableReasoningEffort'],
                            checked,
                            seedEffort ? { params: { reasoning_effort: 'medium' } } : undefined,
                          );
                        }}
                      />
                    }
                  >
                    {enableReasoningEffort && (
                      <Select
                        size={'small'}
                        style={{ width: '100%' }}
                        options={[
                          { label: t('settingModel.reasoningEffort.options.low'), value: 'low' },
                          {
                            label: t('settingModel.reasoningEffort.options.medium'),
                            value: 'medium',
                          },
                          { label: t('settingModel.reasoningEffort.options.high'), value: 'high' },
                        ]}
                        value={
                          typeof reasoningEffortValue === 'string' ? reasoningEffortValue : 'medium'
                        }
                        onChange={(value) => {
                          handleFieldChange(['params', 'reasoning_effort'], value);
                        }}
                      />
                    )}
                  </ControlRow>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default Controls;
