'use client';

import { Text } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PlatformModuleId, PlatformModuleStateMap } from '@/const/platform/modules';

import {
  groupModuleIds,
  MODULE_GROUP_ORDER,
  moduleChildren,
  unmetDependencies,
} from './moduleDraft';
import ModuleRow from './ModuleRow';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    display: flex;
    flex-direction: column;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  childDivider: css`
    height: 1px;
    margin: 0;
    margin-inline-start: 12px;
    border: none;

    background: ${cssVar.colorFillSecondary};
  `,
  /** The indented rail children hang off — the tree is legible without reading the copy. */
  children: css`
    display: flex;
    flex-direction: column;

    margin-block-end: 12px;
    margin-inline: 16px;
    padding-inline-start: 12px;
    border-inline-start: 2px solid ${cssVar.colorBorderSecondary};
  `,
  coreRow: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block: 10px;
    padding-inline: 16px;
  `,
  divider: css`
    height: 1px;
    margin: 0;
    border: none;
    background: ${cssVar.colorBorderSecondary};
  `,
  group: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  groupHeader: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
  `,
  root: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
  `,
  summary: css`
    cursor: pointer;
    padding-block: 12px;
    padding-inline: 16px;
    font-weight: 500;
  `,
  toolbarButton: css`
    cursor: pointer;

    padding-block: 2px;
    padding-inline: 8px;
    border: none;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: none;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
}));

export interface ModuleGroupListProps {
  /** The draft — each switch's own (requested) choice. */
  draft: PlatformModuleStateMap;
  /** `resolveModuleTree(draft)` — what actually runs once parents and dependencies apply. */
  effective: PlatformModuleStateMap;
  envDisabledBy: Partial<Record<PlatformModuleId, string>>;
  onToggle: (id: PlatformModuleId, next: boolean) => void;
  pendingRestart: PlatformModuleId[];
  readOnly: boolean;
}

/**
 * The module tree: three cards (平台管理 / 集成 / 应用功能), each listing its top-level modules
 * with their children nested underneath.
 *
 * A child keeps its own switch position while its parent is off — greyed, locked, and with a
 * tooltip naming what has to be switched on first — so turning the parent back on restores the
 * operator's selection instead of silently resetting it. Every subtree starts expanded: these
 * rows are exactly what an operator looking for "the new modules" needs to see. A card that
 * holds subtrees gets its own 全部展开 / 全部收起 in its header.
 */
const ModuleGroupList = memo<ModuleGroupListProps>(
  ({ draft, effective, envDisabledBy, onToggle, pendingRestart, readOnly }) => {
    const { t } = useTranslation('admin');
    const baseId = useId();
    const groups = useMemo(() => groupModuleIds(), []);
    const pending = useMemo(() => new Set(pendingRestart), [pendingRestart]);
    const [collapsed, setCollapsed] = useState<ReadonlySet<PlatformModuleId>>(
      () => new Set<PlatformModuleId>(),
    );

    const toggleSubtree = useCallback((id: PlatformModuleId) => {
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    /** 全部展开 / 全部收起 for one card: acts on that card's subtrees only. */
    const toggleGroup = useCallback((parents: readonly PlatformModuleId[]) => {
      setCollapsed((previous) => {
        const expand = parents.every((id) => previous.has(id));
        const next = new Set(previous);
        for (const id of parents) {
          if (expand) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    }, []);

    const renderRow = (id: PlatformModuleId, nested: boolean) => {
      const children = moduleChildren(id);
      const childrenId = `${baseId}-${id}-children`;
      return (
        <ModuleRow
          blockedBy={unmetDependencies(id, draft, effective)}
          blockerEnv={envDisabledBy}
          checked={draft[id]}
          envDisabledBy={envDisabledBy[id]}
          id={id}
          nested={nested}
          pendingRestart={pending.has(id)}
          readOnly={readOnly}
          expand={
            children.length > 0
              ? {
                  controls: childrenId,
                  count: children.length,
                  expanded: !collapsed.has(id),
                  onToggle: () => toggleSubtree(id),
                }
              : undefined
          }
          onChange={(next) => onToggle(id, next)}
        />
      );
    };

    const renderTree = (id: PlatformModuleId) => {
      const children = moduleChildren(id);
      const expanded = !collapsed.has(id);
      return (
        <>
          {renderRow(id, false)}
          {children.length > 0 && expanded ? (
            <div
              aria-label={t(`modules.items.${id}.title` as never, { defaultValue: id })}
              className={styles.children}
              data-children-of={id}
              id={`${baseId}-${id}-children`}
              role="group"
            >
              {children.map((child, index) => (
                <div key={child}>
                  {index === 0 ? null : <hr className={styles.childDivider} />}
                  {renderRow(child, true)}
                </div>
              ))}
            </div>
          ) : null}
        </>
      );
    };

    const visibleGroups = MODULE_GROUP_ORDER.filter((group) => groups[group].length > 0);

    return (
      <div className={styles.root}>
        {visibleGroups.map((group) => {
          // The control belongs on the card whose subtrees it folds — and only there.
          const parents = groups[group].filter((id) => moduleChildren(id).length > 0);
          const allCollapsed = parents.every((id) => collapsed.has(id));
          return (
            <section className={styles.group} data-module-group={group} key={group}>
              <div className={styles.groupHeader}>
                <Text strong>{t(`modules.groups.${group}` as never)}</Text>
                {parents.length > 0 ? (
                  <button
                    className={styles.toolbarButton}
                    type="button"
                    onClick={() => toggleGroup(parents)}
                  >
                    {t(allCollapsed ? 'modules.expandAll' : 'modules.collapseAll')}
                  </button>
                ) : null}
              </div>
              <div className={styles.card}>
                {groups[group].map((id, index) => (
                  <div key={id}>
                    {index === 0 ? null : <hr className={styles.divider} />}
                    {renderTree(id)}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  },
);

ModuleGroupList.displayName = 'AdminModuleGroupList';

/** Areas that are not modules at all — listed so their absence from the switches is not a mystery. */
const CORE_AREA_KEYS = ['chat', 'users', 'auth', 'adminShell'] as const;

export const CoreModulesFooter = memo(() => {
  const { t } = useTranslation('admin');

  return (
    <details className={styles.card}>
      <summary className={styles.summary}>{t('modules.core.title')}</summary>
      <hr className={styles.divider} />
      {CORE_AREA_KEYS.map((key) => (
        <div className={styles.coreRow} key={key}>
          <Text type="secondary">{t(`modules.core.items.${key}` as never)}</Text>
          <Switch checked disabled />
        </div>
      ))}
    </details>
  );
});

CoreModulesFooter.displayName = 'AdminCoreModulesFooter';

export default ModuleGroupList;
