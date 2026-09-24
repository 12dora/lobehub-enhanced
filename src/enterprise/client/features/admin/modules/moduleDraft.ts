import {
  MODULE_CHILDREN,
  moduleBlockers,
  modulesForPreset,
  PLATFORM_MODULE_IDS,
  PLATFORM_MODULE_PRESETS,
  PLATFORM_MODULES,
  type PlatformModuleExternalDep,
  type PlatformModuleGroup,
  type PlatformModuleId,
  type PlatformModulePreset,
  type PlatformModuleStateMap,
  resolveModuleTree,
} from '@/const/platform/modules';

/**
 * Pure draft/summary maths for the 模块配置 page. Kept out of the components so the numbers the
 * operator makes a deployment decision on are directly testable.
 *
 * Two views of the same selection run through this file:
 *  - the **draft** is the *requested* map — each switch's own choice, exactly what gets saved;
 *  - the **effective** map is `resolveModuleTree(draft)` — what actually runs once parents and
 *    hard dependencies are applied. A child whose parent is off keeps its own choice in the
 *    draft but is off here.
 * Saving diffs the draft against the stored `requested` map; anything that talks about cost or
 * presets reads the effective map, because that is what the deployment will really run.
 */

export interface ModuleCostSummary {
  /** Background workers / pollers owned by the enabled set (idle CPU + DB traffic). */
  backgroundJobs: number;
  /** Union of the external services the enabled set needs. */
  externalDeps: PlatformModuleExternalDep[];
  /** Sum of the measured resident-memory estimates, in MB. */
  idleRssMb: number;
  /** Enabled modules that DO carry a measurement. Zero ⇒ the memory total means nothing. */
  measured: number;
  /** Enabled modules whose `idleRssMb` has not been measured yet — the number is a floor. */
  unmeasured: number;
  /**
   * Enabled modules that add fixed work to traffic rather than only when their own feature is
   * used — the same set the rows chip as running on every message / request / outbound request.
   * `onUse` is excluded because on-demand work is not a standing cost.
   */
  workPerRequest: number;
}

/**
 * Aggregate the constant-table costs of everything switched on in `state`. Pass the effective
 * (tree-resolved) map: a child whose parent is off costs nothing, whatever its own switch says.
 */
export const summarizeModules = (state: PlatformModuleStateMap): ModuleCostSummary => {
  const deps = new Set<PlatformModuleExternalDep>();
  let backgroundJobs = 0;
  let idleRssMb = 0;
  let measured = 0;
  let unmeasured = 0;
  let workPerRequest = 0;

  for (const id of PLATFORM_MODULE_IDS) {
    if (!state[id]) continue;
    const { cost } = PLATFORM_MODULES[id];
    backgroundJobs += cost.backgroundJobs;
    if (cost.idleRssMb === null) unmeasured += 1;
    else {
      idleRssMb += cost.idleRssMb;
      measured += 1;
    }
    if (cost.loadKind !== 'none' && cost.loadKind !== 'onUse') workPerRequest += 1;
    for (const dep of cost.externalDeps) deps.add(dep);
  }

  return {
    backgroundJobs,
    externalDeps: [...deps].sort(),
    idleRssMb,
    measured,
    unmeasured,
    workPerRequest,
  };
};

/** State map of a preset — the baseline the summary bar compares against. */
export const presetStateMap = (preset: PlatformModulePreset): PlatformModuleStateMap => {
  const enabled = modulesForPreset(preset);
  return Object.freeze(
    Object.fromEntries(PLATFORM_MODULE_IDS.map((id) => [id, enabled.has(id)])),
  ) as PlatformModuleStateMap;
};

export interface PresetComparison {
  /** draft − preset. Negative = the draft is lighter than the preset. */
  backgroundJobsDelta: number;
  /**
   * False when either side has unmeasured modules: subtracting two partial sums produces a
   * number that looks precise and is not. Callers must hide the memory half of the comparison.
   */
  idleRssComparable: boolean;
  idleRssMbDelta: number;
  preset: PlatformModulePreset;
}

/**
 * Compare an effective (tree-resolved) selection against every preset, so the bar can say
 * "比标准配置少 N 个后台任务".
 */
export const comparePresets = (effective: PlatformModuleStateMap): PresetComparison[] => {
  const summary = summarizeModules(effective);
  return PLATFORM_MODULE_PRESETS.map((preset) => {
    const base = summarizeModules(resolveModuleTree(presetStateMap(preset)));
    return {
      backgroundJobsDelta: summary.backgroundJobs - base.backgroundJobs,
      idleRssComparable: summary.unmeasured === 0 && base.unmeasured === 0,
      idleRssMbDelta: summary.idleRssMb - base.idleRssMb,
      preset,
    };
  });
};

export interface ModuleDraftDiff {
  dirty: boolean;
  /** Modules the draft switches OFF. */
  disabled: PlatformModuleId[];
  /** Modules the draft switches ON. */
  enabled: PlatformModuleId[];
  /** Changed modules that own boot-time facilities — resources only free up after a restart. */
  restartRequired: PlatformModuleId[];
}

/**
 * What changes between two state maps of the same kind: stored `requested` vs the draft for
 * what a save writes, or the two tree-resolved maps for what will actually start / stop.
 */
export const diffModuleDraft = (
  base: PlatformModuleStateMap,
  draft: PlatformModuleStateMap,
): ModuleDraftDiff => {
  const enabled: PlatformModuleId[] = [];
  const disabled: PlatformModuleId[] = [];
  const restartRequired: PlatformModuleId[] = [];

  for (const id of PLATFORM_MODULE_IDS) {
    if (base[id] === draft[id]) continue;
    if (draft[id]) enabled.push(id);
    else disabled.push(id);
    if (PLATFORM_MODULES[id].kind === 'restart') restartRequired.push(id);
  }

  return {
    dirty: enabled.length > 0 || disabled.length > 0,
    disabled,
    enabled,
    restartRequired,
  };
};

/**
 * Only send what changed — a partial map keeps another admin's concurrent edit intact.
 *
 * Diffed against the stored `requested` map, never the effective one: a child greyed out by its
 * parent is already off in the effective map, so diffing there would silently drop the operator's
 * own choice for it (and, worse, write `false` for children the tree merely switched off).
 */
export const draftToUpdatePayload = (
  requested: PlatformModuleStateMap,
  draft: PlatformModuleStateMap,
): Partial<Record<PlatformModuleId, boolean>> => {
  const payload: Partial<Record<PlatformModuleId, boolean>> = {};
  for (const id of PLATFORM_MODULE_IDS) {
    if (requested[id] !== draft[id]) payload[id] = draft[id];
  }
  return payload;
};

/**
 * Apply a preset to the draft without losing env-pinned modules: env can only disable, and the
 * console cannot undo it, so a preset never flips one of those back on.
 */
export const applyPresetToDraft = (
  preset: PlatformModulePreset,
  envDisabled: readonly PlatformModuleId[],
): PlatformModuleStateMap => {
  const enabled = modulesForPreset(preset);
  const pinned = new Set(envDisabled);
  return Object.freeze(
    Object.fromEntries(
      PLATFORM_MODULE_IDS.map((id) => [id, pinned.has(id) ? false : enabled.has(id)]),
    ),
  ) as PlatformModuleStateMap;
};

/**
 * Preset the draft currently amounts to, or null = 自定义.
 *
 * A preset matches when the draft runs exactly what *applying that preset here* would run:
 * both sides tree-resolved, and the preset applied with the env pins (`applyPresetToDraft`).
 * - With 钉钉 off, its children's own choices do not change what runs, so they must not
 *   change which preset the page says is selected either.
 * - Env-pinned modules (and the children they switch off) are the same on both sides, so they
 *   never break a match. Comparing against the bare preset instead made a deployment with
 *   `GLOBAL_FILE_ORPHAN_GC=0` read 自定义 forever — even right after clicking a preset.
 *
 * When env pins make several presets equivalent (e.g. `LOBE_MODULE_PRESET=standard` leaves
 * 标准 and 完整 identical), the smallest one wins — the order of `PLATFORM_MODULE_PRESETS`.
 */
export const draftPreset = (
  draft: PlatformModuleStateMap,
  envDisabled: readonly PlatformModuleId[] = [],
): PlatformModulePreset | null => {
  const effective = resolveModuleTree(draft);
  return (
    PLATFORM_MODULE_PRESETS.find((preset) => {
      const target = resolveModuleTree(applyPresetToDraft(preset, envDisabled));
      return PLATFORM_MODULE_IDS.every((id) => effective[id] === target[id]);
    }) ?? null
  );
};

/**
 * Toggle one module in a draft (returns a new frozen map). Only that module's own choice moves:
 * switching a parent off leaves every child's choice where the operator put it, so switching the
 * parent back on restores the selection instead of resetting it.
 */
export const setModuleInDraft = (
  draft: PlatformModuleStateMap,
  id: PlatformModuleId,
  value: boolean,
): PlatformModuleStateMap => Object.freeze({ ...draft, [id]: value }) as PlatformModuleStateMap;

/**
 * The switches the operator has to turn on before `id` can take effect — its parent and hard
 * dependencies, followed up the tree. A blocker whose own switch is already on is only off
 * because of something above it, so that ancestor is named instead: with 钉钉 off and
 * 工作通知与提醒 left on, 日程与待办 needs 钉钉, not both. Empty ⇒ nothing blocks it.
 */
export const unmetDependencies = (
  id: PlatformModuleId,
  draft: PlatformModuleStateMap,
  effective: PlatformModuleStateMap = resolveModuleTree(draft),
): PlatformModuleId[] => {
  const out: PlatformModuleId[] = [];
  const seen = new Set<PlatformModuleId>([id]);

  const visit = (blockers: readonly PlatformModuleId[]) => {
    for (const blocker of blockers) {
      if (seen.has(blocker)) continue;
      seen.add(blocker);
      const above = draft[blocker] ? moduleBlockers(blocker, effective) : [];
      if (above.length > 0) visit(above);
      else out.push(blocker);
    }
  };

  visit(moduleBlockers(id, effective));
  return out;
};

/** Page order: what an operator came to size down first, then integrations, then app features. */
export const MODULE_GROUP_ORDER: readonly PlatformModuleGroup[] = [
  'platform',
  'integration',
  'app',
];

/** Direct children of a module in the tree (constant-table order); empty for a leaf. */
export const moduleChildren = (id: PlatformModuleId): readonly PlatformModuleId[] =>
  MODULE_CHILDREN[id] ?? [];

/** Modules that head a subtree — the rows that get an expand / collapse control. */
export const PARENT_MODULE_IDS: readonly PlatformModuleId[] = PLATFORM_MODULE_IDS.filter(
  (id) => moduleChildren(id).length > 0,
);

/**
 * Top-level rows per group, each keeping the constant table's order. Children are not listed
 * here — they render under their parent (`moduleChildren`), wherever that parent is grouped.
 */
export const groupModuleIds = (): Record<PlatformModuleGroup, PlatformModuleId[]> => {
  const groups: Record<PlatformModuleGroup, PlatformModuleId[]> = {
    app: [],
    integration: [],
    platform: [],
  };
  for (const id of PLATFORM_MODULE_IDS) {
    const { group, parent } = PLATFORM_MODULES[id];
    if (parent) continue;
    groups[group].push(id);
  }
  return groups;
};
