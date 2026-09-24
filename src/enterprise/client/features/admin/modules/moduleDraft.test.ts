import { describe, expect, it } from 'vitest';

import {
  ALL_MODULES_ENABLED,
  PLATFORM_MODULE_IDS,
  PLATFORM_MODULES,
  type PlatformModuleId,
  type PlatformModuleStateMap,
  resolveModuleTree,
} from '@/const/platform/modules';

import {
  applyPresetToDraft,
  comparePresets,
  diffModuleDraft,
  draftPreset,
  draftToUpdatePayload,
  groupModuleIds,
  MODULE_GROUP_ORDER,
  moduleChildren,
  PARENT_MODULE_IDS,
  presetStateMap,
  setModuleInDraft,
  summarizeModules,
  unmetDependencies,
} from './moduleDraft';

const withOff = (...ids: readonly (typeof PLATFORM_MODULE_IDS)[number][]): PlatformModuleStateMap =>
  Object.freeze({
    ...ALL_MODULES_ENABLED,
    ...Object.fromEntries(ids.map((id) => [id, false])),
  }) as PlatformModuleStateMap;

describe('summarizeModules', () => {
  it('adds up only what is switched on', () => {
    const all = summarizeModules(ALL_MODULES_ENABLED);
    const withoutAudit = summarizeModules(withOff('audit'));

    expect(all.backgroundJobs - withoutAudit.backgroundJobs).toBe(
      PLATFORM_MODULES.audit.cost.backgroundJobs,
    );
  });

  it('counts standing traffic cost, and does not count on-demand work as one', () => {
    const standingIds = PLATFORM_MODULE_IDS.filter((id) =>
      ['perFetch', 'perMessage', 'perRequest'].includes(PLATFORM_MODULES[id].cost.loadKind),
    );
    // The rows chip exactly these three kinds; a summary that counted a different set would
    // disagree with the chips right below it.
    expect(summarizeModules(ALL_MODULES_ENABLED).workPerRequest).toBe(standingIds.length);
    expect(summarizeModules(withOff(...standingIds)).workPerRequest).toBe(0);

    const onUseIds = PLATFORM_MODULE_IDS.filter(
      (id) => PLATFORM_MODULES[id].cost.loadKind === 'onUse',
    );
    expect(onUseIds.length).toBeGreaterThan(0);
    expect(summarizeModules(withOff(...standingIds, ...onUseIds)).workPerRequest).toBe(0);
  });

  it('reports unmeasured modules instead of pretending the memory total is complete', () => {
    const unmeasuredIds = PLATFORM_MODULE_IDS.filter(
      (id) => PLATFORM_MODULES[id].cost.idleRssMb === null,
    );
    expect(summarizeModules(ALL_MODULES_ENABLED).unmeasured).toBe(unmeasuredIds.length);
  });

  it('unions external dependencies and drops them once the last owner is off', () => {
    const s3Owners = PLATFORM_MODULE_IDS.filter((id) =>
      PLATFORM_MODULES[id].cost.externalDeps.includes('s3'),
    );
    expect(summarizeModules(ALL_MODULES_ENABLED).externalDeps).toContain('s3');
    expect(summarizeModules(withOff(...s3Owners)).externalDeps).not.toContain('s3');
  });

  it('does not charge for children their parent switches off, whatever their own choice', () => {
    const family: PlatformModuleId[] = ['dingtalk', ...moduleChildren('dingtalk')];
    const familyJobs = family.reduce(
      (sum, id) => sum + PLATFORM_MODULES[id].cost.backgroundJobs,
      0,
    );

    // Only the parent's own switch moves; every child still says "on" in the draft.
    const all = summarizeModules(ALL_MODULES_ENABLED);
    const withoutDingTalk = summarizeModules(resolveModuleTree(withOff('dingtalk')));
    expect(all.backgroundJobs - withoutDingTalk.backgroundJobs).toBe(familyJobs);
  });

  it('is empty when nothing is enabled', () => {
    const none = Object.freeze(
      Object.fromEntries(PLATFORM_MODULE_IDS.map((id) => [id, false])),
    ) as PlatformModuleStateMap;
    expect(summarizeModules(none)).toEqual({
      backgroundJobs: 0,
      externalDeps: [],
      idleRssMb: 0,
      measured: 0,
      unmeasured: 0,
      workPerRequest: 0,
    });
  });

  it('counts how many enabled modules actually carry a measurement', () => {
    // `measured === 0` is what lets the UI say 未测量 rather than a confident "≥ 0 MB".
    const measuredIds = PLATFORM_MODULE_IDS.filter(
      (id) => PLATFORM_MODULES[id].cost.idleRssMb !== null,
    );
    expect(summarizeModules(ALL_MODULES_ENABLED).measured).toBe(measuredIds.length);
  });
});

describe('presets', () => {
  it('full is everything on and matches the all-enabled default', () => {
    expect(presetStateMap('full')).toEqual(ALL_MODULES_ENABLED);
    expect(draftPreset(ALL_MODULES_ENABLED)).toBe('full');
  });

  it('marks a hand-edited selection as custom', () => {
    expect(draftPreset(withOff('taskTemplates'))).toBeNull();
    expect(draftPreset(withOff('dingtalk'))).toBeNull();
  });

  it('matches presets on what runs, not on the own choice of a child its parent blocks', () => {
    // Standard leaves 钉钉 off. A stored "on" for one of its children changes nothing that runs,
    // so it must not knock the selection off the Standard card.
    const standard = presetStateMap('standard');
    expect(standard.dingtalk).toBe(false);
    const draft = setModuleInDraft(standard, 'dingtalkChat', true);

    expect(draftPreset(draft)).toBe('standard');
  });

  it('matches the preset just applied although an env pin keeps one of its modules off', () => {
    // GLOBAL_FILE_ORPHAN_GC=0 pins 孤儿文件清理 off, and every preset includes it.
    const pinned: PlatformModuleId[] = ['fileOrphanGc'];
    for (const preset of ['minimal', 'standard', 'full'] as const) {
      const draft = applyPresetToDraft(preset, pinned);
      expect(draft.fileOrphanGc).toBe(false);
      expect(draftPreset(draft, pinned)).toBe(preset);
    }
    // Compared against the bare preset instead, nothing could ever match.
    expect(draftPreset(applyPresetToDraft('full', pinned))).toBeNull();
  });

  it('still reports custom when a switchable module differs from the preset', () => {
    const pinned: PlatformModuleId[] = ['fileOrphanGc'];
    const draft = setModuleInDraft(applyPresetToDraft('full', pinned), 'taskTemplates', false);

    expect(draftPreset(draft, pinned)).toBeNull();
  });

  it('does not let an env-pinned parent break the match through the children it blocks', () => {
    // 钉钉 pinned off: its children keep their own "on" but cannot run, on both sides.
    const pinned: PlatformModuleId[] = ['dingtalk'];
    const draft = applyPresetToDraft('full', pinned);
    expect(draft.dingtalkChat).toBe(true);

    expect(draftPreset(draft, pinned)).toBe('full');
  });

  it('picks the smallest preset when env pins make several equivalent', () => {
    // LOBE_MODULE_PRESET=standard pins every full-tier module off: 标准 and 完整 now coincide.
    const pinned = PLATFORM_MODULE_IDS.filter((id) => PLATFORM_MODULES[id].tier === 'full');
    const draft = applyPresetToDraft('full', pinned);

    expect(draftPreset(draft, pinned)).toBe('standard');
    expect(draftPreset(applyPresetToDraft('minimal', pinned), pinned)).toBe('minimal');
  });

  it('never re-enables a module env pinned off, even when the preset includes it', () => {
    const draft = applyPresetToDraft('full', ['audit']);
    expect(draft.audit).toBe(false);
    expect(draft.moderation).toBe(true);
  });

  it('compares against a preset by cost, not by module count', () => {
    const standard = comparePresets(presetStateMap('standard')).find(
      (entry) => entry.preset === 'standard',
    );
    expect(standard).toMatchObject({
      backgroundJobsDelta: 0,
      idleRssMbDelta: 0,
      preset: 'standard',
    });

    const lighter = comparePresets(presetStateMap('minimal')).find(
      (entry) => entry.preset === 'standard',
    );
    expect(lighter!.backgroundJobsDelta).toBeLessThan(0);
  });

  it('marks a memory comparison incomparable while either side has unmeasured modules', () => {
    // Subtracting two partial sums yields a number that looks precise and is not.
    const anyUnmeasured = PLATFORM_MODULE_IDS.some(
      (id) => PLATFORM_MODULES[id].cost.idleRssMb === null,
    );
    const standard = comparePresets(ALL_MODULES_ENABLED).find(
      (entry) => entry.preset === 'standard',
    )!;
    expect(standard.idleRssComparable).toBe(!anyUnmeasured);
    // The job-count half stays usable either way — it is exact.
    expect(Number.isInteger(standard.backgroundJobsDelta)).toBe(true);
  });
});

describe('diffModuleDraft', () => {
  it('is clean when the draft equals the effective state', () => {
    const diff = diffModuleDraft(ALL_MODULES_ENABLED, ALL_MODULES_ENABLED);
    expect(diff).toEqual({ dirty: false, disabled: [], enabled: [], restartRequired: [] });
  });

  it('separates switch-ons from switch-offs and flags the restart-kind ones', () => {
    const effective = withOff('moderation');
    const draft = setModuleInDraft(setModuleInDraft(effective, 'moderation', true), 'audit', false);
    const diff = diffModuleDraft(effective, draft);

    expect(diff.enabled).toEqual(['moderation']);
    expect(diff.disabled).toEqual(['audit']);
    // both are boot-time facilities in the constant table
    expect(diff.restartRequired).toEqual(expect.arrayContaining(['audit', 'moderation']));
    expect(diff.dirty).toBe(true);
  });

  it('does not list a hot module as needing a restart', () => {
    const hotId = PLATFORM_MODULE_IDS.find((id) => PLATFORM_MODULES[id].kind === 'hot')!;
    const diff = diffModuleDraft(ALL_MODULES_ENABLED, withOff(hotId));
    expect(diff.restartRequired).toEqual([]);
  });

  it('on tree-resolved maps, counts the children a parent switches off', () => {
    const requestedDiff = diffModuleDraft(ALL_MODULES_ENABLED, withOff('dingtalk'));
    expect(requestedDiff.disabled).toEqual(['dingtalk']);

    const effectiveDiff = diffModuleDraft(
      resolveModuleTree(ALL_MODULES_ENABLED),
      resolveModuleTree(withOff('dingtalk')),
    );
    expect(effectiveDiff.disabled).toEqual(
      expect.arrayContaining(['dingtalk', ...moduleChildren('dingtalk')]),
    );
    const family: PlatformModuleId[] = ['dingtalk', ...moduleChildren('dingtalk')];
    const restartKind = family.filter((id) => PLATFORM_MODULES[id].kind === 'restart');
    expect([...effectiveDiff.restartRequired].sort()).toEqual(restartKind.sort());
  });
});

describe('draftToUpdatePayload', () => {
  it('sends only what changed so a concurrent edit elsewhere survives', () => {
    expect(draftToUpdatePayload(ALL_MODULES_ENABLED, withOff('audit'))).toEqual({ audit: false });
  });

  it('is empty for an unchanged draft', () => {
    expect(draftToUpdatePayload(ALL_MODULES_ENABLED, ALL_MODULES_ENABLED)).toEqual({});
  });

  it('writes only the parent when a parent goes off — children keep their stored choice', () => {
    // The tree switches every DingTalk child off, but none of them was touched: writing `false`
    // for them would wipe the operator's selection the next time 钉钉 comes back on.
    expect(draftToUpdatePayload(ALL_MODULES_ENABLED, withOff('dingtalk'))).toEqual({
      dingtalk: false,
    });
  });

  it('persists a child choice made while its parent is off', () => {
    const requested = withOff('dingtalk');
    const draft = setModuleInDraft(requested, 'dingtalkDocs', false);

    // Nothing changes in what runs (the parent is still off), yet the choice is real and saved.
    expect(resolveModuleTree(draft)).toEqual(resolveModuleTree(requested));
    expect(draftToUpdatePayload(requested, draft)).toEqual({ dingtalkDocs: false });
  });
});

describe('unmetDependencies', () => {
  it('is empty with everything on, and a module switched off by itself is not blocked', () => {
    for (const id of PLATFORM_MODULE_IDS) {
      expect(unmetDependencies(id, ALL_MODULES_ENABLED)).toEqual([]);
      expect(unmetDependencies(id, withOff(id))).toEqual([]);
    }
  });

  it('blocks a child on its parent and on every hard dependency, for the whole table', () => {
    for (const id of PLATFORM_MODULE_IDS) {
      const { dependsOn, parent } = PLATFORM_MODULES[id];
      if (parent) expect(unmetDependencies(id, withOff(parent))).toContain(parent);
      for (const dep of dependsOn) expect(unmetDependencies(id, withOff(dep))).toContain(dep);
    }
  });

  it('names the parent of a DingTalk capability once 钉钉 is off', () => {
    expect(unmetDependencies('dingtalkChat', withOff('dingtalk'))).toEqual(['dingtalk']);
    expect(unmetDependencies('dingtalkChat', withOff('dingtalkNotify'))).toEqual([]);
  });

  it('names a hard dependency that is off', () => {
    expect(unmetDependencies('dingtalkWorkspace', withOff('dingtalkNotify'))).toEqual([
      'dingtalkNotify',
    ]);
    expect(unmetDependencies('dingtalkDocs', withOff('dingtalkPersonal'))).toEqual([
      'dingtalkPersonal',
    ]);
  });

  it('names only the switches that are actually off, not what they merely inherit', () => {
    // 工作通知与提醒 is still on in the draft — it is off only because 钉钉 is. Turning 钉钉 on
    // is the whole fix, so that is the one name the operator gets.
    expect(unmetDependencies('dingtalkWorkspace', withOff('dingtalk'))).toEqual(['dingtalk']);

    // Both off by their own switch ⇒ both have to be turned on.
    const both = unmetDependencies('dingtalkWorkspace', withOff('dingtalk', 'dingtalkNotify'));
    expect([...both].sort()).toEqual(['dingtalk', 'dingtalkNotify']);
  });
});

describe('grouping', () => {
  it('lists every module exactly once: as a top-level row or under its parent', () => {
    const groups = groupModuleIds();
    const topLevel = MODULE_GROUP_ORDER.flatMap((group) => groups[group]);
    const nested = topLevel.flatMap((id) => moduleChildren(id));
    const all = [...topLevel, ...nested];

    expect([...all].sort()).toEqual([...PLATFORM_MODULE_IDS].sort());
    expect(new Set(all).size).toBe(all.length);
    for (const id of nested) expect(PLATFORM_MODULES[id].parent).toBeDefined();
  });

  it('puts 钉钉 in 集成 with its capabilities nested under it', () => {
    const { app, integration, platform } = groupModuleIds();

    expect(integration).toEqual(expect.arrayContaining(['dingtalk', 'bots', 'enterpriseLookup']));
    expect(platform).toEqual(expect.arrayContaining(['audit', 'fileOrphanGc']));
    expect(app).toEqual(expect.arrayContaining(['knowledgeBase', 'memory']));
    // No child is ever a top-level row.
    expect([...app, ...integration, ...platform]).not.toContain('dingtalkChat');

    expect([...moduleChildren('dingtalk')].sort()).toEqual(
      [
        'dingtalkApproval',
        'dingtalkChat',
        'dingtalkDocs',
        'dingtalkNotify',
        'dingtalkPersonal',
        'dingtalkWorkspace',
      ].sort(),
    );
    expect(PARENT_MODULE_IDS).toContain('dingtalk');
  });
});
