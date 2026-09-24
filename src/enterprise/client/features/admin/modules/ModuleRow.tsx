'use client';

import { Flexbox, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  PLATFORM_MODULES,
  type PlatformModuleId,
  type PlatformModuleLoadKind,
} from '@/const/platform/modules';

import ModuleHelp from './ModuleHelp';

const styles = createStaticStyles(({ css }) => ({
  chevron: css`
    display: inline-flex;
    transition: transform 0.15s ease;

    &[data-expanded='true'] {
      transform: rotate(90deg);
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  /** A child whose parent / dependency is off: its own choice stays visible, but greyed. */
  dimmed: css`
    opacity: 0.55;
  `,
  expand: css`
    cursor: pointer;

    display: inline-flex;
    gap: 2px;
    align-items: center;

    padding-block: 1px;
    padding-inline: 4px 8px;
    border: none;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    line-height: 20px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  meta: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;

    margin-block-start: 6px;
  `,
  row: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px 24px;
    align-items: flex-start;
    justify-content: space-between;

    padding: 16px;
  `,
  /** Nested under a parent: the parent's indented rail already frames it. */
  rowNested: css`
    padding-block: 12px;
    padding-inline: 12px 0;
  `,
  text: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;

    min-width: 240px;
  `,
  title: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  `,
}));

/**
 * Load kinds that deserve a chip. `none` never had one, and `onUse` — idle until someone uses
 * the feature — is the benign default rather than a cost: it sat on 11 of 23 rows and told an
 * operator nothing they could act on, which is what made the whole row read as decoration.
 */
const CHIPPED_LOAD_KINDS = new Set<PlatformModuleLoadKind>([
  'perRequest',
  'perMessage',
  'perFetch',
]);

/**
 * Modules whose description needs more than one line. The detail lives behind a "?" beside the
 * title (`modules.items.<id>.hint`) so the row itself stays one short line.
 */
const HINTED_MODULES: ReadonlySet<PlatformModuleId> = new Set<PlatformModuleId>(['sandbox']);

interface CostTag {
  color?: 'error';
  key: string;
  label: string;
}

/** Expand / collapse affordance of a row that heads a subtree. */
export interface ModuleRowExpand {
  /** Id of the element holding the children (`aria-controls`). */
  controls: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}

export interface ModuleRowProps {
  /**
   * Parent / hard dependencies that are off, so this module cannot run whatever its own switch
   * says. Non-empty ⇒ the switch is locked, the row is greyed and a tooltip names them.
   */
  blockedBy?: readonly PlatformModuleId[];
  /**
   * Env variable pinning each blocker off, where one does. Such a blocker cannot be switched on
   * from this page, so the tooltip points at the container parameter instead.
   */
  blockerEnv?: Partial<Record<PlatformModuleId, string>>;
  /** The module's own choice (the *requested* state) — kept even while a parent blocks it. */
  checked: boolean;
  /** Env variable that pinned this module off; disables the switch and explains why. */
  envDisabledBy?: string;
  /** Present on a row that has children. */
  expand?: ModuleRowExpand;
  id: PlatformModuleId;
  /** Rendered inside its parent's subtree. */
  nested?: boolean;
  onChange: (next: boolean) => void;
  /** Toggled in the draft but only released after a restart. */
  pendingRestart: boolean;
  /** SYSTEM_OPERATE — read-only admins see the state but cannot change it. */
  readOnly: boolean;
}

const NO_BLOCKERS: readonly PlatformModuleId[] = [];

/**
 * One switchable module: what it is, what it costs, and whether anything about the current
 * draft makes it special (env-pinned, pending restart, blocked by a parent or dependency).
 *
 * The cost tags come from the constant table, not from a runtime probe — they are measured
 * once on a reference build so the page can answer "what do I get back" before saving rather
 * than after.
 */
const ModuleRow = memo<ModuleRowProps>(
  ({
    blockedBy = NO_BLOCKERS,
    blockerEnv,
    checked,
    envDisabledBy,
    expand,
    id,
    nested,
    onChange,
    pendingRestart,
    readOnly,
  }) => {
    const { t } = useTranslation('admin');
    const { cost, kind } = PLATFORM_MODULES[id];
    const blocked = blockedBy.length > 0;
    const locked = Boolean(envDisabledBy) || readOnly || blocked;
    // What actually runs: the own choice only counts while nothing above it is off.
    const running = checked && !blocked;

    const status = envDisabledBy
      ? { color: 'default' as const, label: t('modules.status.env') }
      : pendingRestart
        ? { color: 'warning' as const, label: t('modules.status.pendingRestart') }
        : running
          ? { color: 'success' as const, label: t('modules.status.running') }
          : { color: 'default' as const, label: t('modules.status.disabled') };

    const control = (
      <Switch checked={checked} disabled={locked} onChange={(next) => onChange(next)} />
    );

    const quoted = (dep: PlatformModuleId) =>
      t('modules.quoted', {
        name: t(`modules.items.${dep}.title` as never, { defaultValue: dep }),
      });
    // A blocker pinned off by env cannot be switched on here, so "turn it on first" would send
    // the operator to a locked switch: name the variable instead. Blockers they *can* switch on
    // still get the usual line.
    const switchableBlockers = blockedBy.filter((dep) => !blockerEnv?.[dep]);
    // The row's own env pin is the stronger explanation: no switch on this page can undo it.
    const lockLines: string[] = envDisabledBy
      ? [t('modules.envTooltip', { variable: envDisabledBy })]
      : [
          ...blockedBy.flatMap((dep) => {
            const variable = blockerEnv?.[dep];
            return variable ? [t('modules.blockedByEnv', { module: quoted(dep), variable })] : [];
          }),
          ...(switchableBlockers.length > 0
            ? [t('modules.blockedBy', { modules: switchableBlockers.map(quoted).join('、') })]
            : []),
        ];
    const lockReason: ReactNode =
      lockLines.length > 1 ? (
        <>
          {lockLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </>
      ) : (
        (lockLines[0] ?? null)
      );

    // Every chip here has to answer "what does this cost me?". A module that costs nothing
    // notable gets no row at all — silence is the answer, not a chip that says zero.
    const costTags: CostTag[] = [
      kind === 'restart' ? { key: 'restart', label: t('modules.tags.restart') } : null,
      cost.subprocess ? { key: 'subprocess', label: t('modules.tags.subprocess') } : null,
      cost.loadSensitive
        ? { color: 'error' as const, key: 'loadSensitive', label: t('modules.tags.loadSensitive') }
        : null,
      CHIPPED_LOAD_KINDS.has(cost.loadKind)
        ? { key: 'loadKind', label: t(`modules.tags.loadKind.${cost.loadKind}` as never) }
        : null,
      cost.backgroundJobs > 0
        ? {
            key: 'backgroundJobs',
            label: t('modules.tags.backgroundJobs', { n: cost.backgroundJobs }),
          }
        : null,
      ...cost.externalDeps.map((dep) => ({
        key: `dep-${dep}`,
        // The bare noun ("Redis") is a label; what the operator needs is the obligation.
        label: t('modules.tags.requires', { dep: t(`modules.deps.${dep}` as never) }),
      })),
      // 0 MB is the common case now that routers load lazily, and "≈ 0 MB" on 19 of 23 rows
      // buried the four modules that actually hold memory.
      cost.idleRssMb !== null && cost.idleRssMb > 0
        ? { key: 'idleRss', label: t('modules.tags.idleRss', { mb: cost.idleRssMb }) }
        : null,
    ].filter((tag): tag is CostTag => tag !== null);

    return (
      <div
        className={nested ? `${styles.row} ${styles.rowNested}` : styles.row}
        data-blocked={blocked}
        data-module={id}
      >
        <div className={blocked ? `${styles.text} ${styles.dimmed}` : styles.text}>
          <div className={styles.title}>
            <Text strong>
              {t(`modules.items.${id}.title` as never, { defaultValue: id })}
              {HINTED_MODULES.has(id) ? (
                <ModuleHelp
                  field={t(`modules.items.${id}.title` as never, { defaultValue: id })}
                  title={t(`modules.items.${id}.hint` as never, { defaultValue: '' })}
                />
              ) : null}
            </Text>
            <Tag color={status.color} size="small">
              {status.label}
            </Tag>
            {expand ? (
              <button
                aria-controls={expand.controls}
                aria-expanded={expand.expanded}
                className={styles.expand}
                type="button"
                onClick={expand.onToggle}
              >
                <span className={styles.chevron} data-expanded={expand.expanded}>
                  <Icon icon={ChevronRight} size={14} />
                </span>
                {t('modules.children', { n: expand.count })}
              </button>
            ) : null}
          </div>
          <Text type="secondary">
            {t(`modules.items.${id}.desc` as never, { defaultValue: '' })}
          </Text>
          {costTags.length > 0 ? (
            <div className={styles.meta}>
              {costTags.map((tag) => (
                <Tag color={tag.color} key={tag.key} size="small">
                  {tag.label}
                </Tag>
              ))}
            </div>
          ) : null}
        </div>
        <Flexbox horizontal align="center" gap={8}>
          {/* A disabled switch swallows pointer events, so the tooltip hangs off a wrapper. */}
          {lockReason ? (
            <Tooltip title={lockReason}>
              <span>{control}</span>
            </Tooltip>
          ) : (
            control
          )}
        </Flexbox>
      </div>
    );
  },
);

ModuleRow.displayName = 'AdminModuleRow';

export default ModuleRow;
