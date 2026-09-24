import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EFFORT_CONTROL_REGISTRY } from '../../utils/effortControlRegistry';
import {
  type CursorModelGroup,
  groupCursorModels,
  parseCursorModelId,
  resolveCursorModelId,
} from './modelGroups';

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/cursor-list-models.txt'),
  'utf8',
);

const EFFORT_WORD = /\b(?:extra[\s-]+high|minimal|medium|xhigh|none|high|low|max)\b/i;

const parseFixture = (text: string): { id: string; name: string }[] => {
  const models: { id: string; name: string }[] = [];
  for (const raw of text.split('\n')) {
    const separator = raw.indexOf(' - ');
    if (separator <= 0) continue;
    const id = raw.slice(0, separator).trim();
    if (!id || /\s/.test(id)) continue;
    const name = raw.slice(separator + 3).replace(/ \((?:current|default)\)$/i, '');
    if (!name.trim()) continue;
    models.push({ id, name });
  }
  return models;
};

const LIVE = parseFixture(FIXTURE);
const LIVE_IDS = LIVE.map((model) => model.id);
const grouped = groupCursorModels(LIVE);

const group = (baseId: string): CursorModelGroup => {
  const found = grouped.groups.find((item) => item.baseId === baseId);
  if (!found) throw new Error(`missing group ${baseId}`);
  return found;
};

describe('parseCursorModelId', () => {
  it('keeps fast on the base and maps extra-high and effort-before-thinking', () => {
    expect(parseCursorModelId('grok-4.7-high-fast')).toEqual({
      baseId: 'grok-4.7-fast',
      effort: 'high',
      fast: true,
    });
    expect(parseCursorModelId('gpt-5.5-extra-high')).toEqual({
      baseId: 'gpt-5.5',
      effort: 'xhigh',
      fast: false,
    });
    expect(parseCursorModelId('claude-4.6-opus-high-thinking')).toEqual({
      baseId: 'claude-4.6-opus-thinking',
      effort: 'high',
      fast: false,
    });
    expect(parseCursorModelId('claude-opus-5-thinking-high')).toEqual({
      baseId: 'claude-opus-5-thinking',
      effort: 'high',
      fast: false,
    });
    expect(parseCursorModelId('gpt-5.3-codex')).toEqual({
      baseId: 'gpt-5.3-codex',
      effort: null,
      fast: false,
    });
    expect(parseCursorModelId('composer-2.5-fast')).toEqual({
      baseId: 'composer-2.5-fast',
      effort: null,
      fast: true,
    });
  });
});

describe('groupCursorModels live fixture', () => {
  it('accounts for every listed id exactly once', () => {
    expect(LIVE.length).toBeGreaterThan(200);

    const seen = new Map<string, number>();
    for (const item of grouped.groups) {
      expect(item.levels.length, item.baseId).toBeGreaterThanOrEqual(2);
      for (const id of Object.values(item.members)) {
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
    for (const single of grouped.singles) seen.set(single.id, (seen.get(single.id) ?? 0) + 1);

    for (const model of LIVE) expect(seen.get(model.id), model.id).toBe(1);
    expect(seen.size).toBe(LIVE.length);
  });

  it('sorts levels, keeps fast bases apart, and cleans display names', () => {
    const order = EFFORT_CONTROL_REGISTRY.cursorReasoningEffort.levels as readonly string[];
    for (const item of grouped.groups) {
      const sorted = [...item.levels].sort(
        (left, right) => order.indexOf(left) - order.indexOf(right),
      );
      expect(item.levels, item.baseId).toEqual(sorted);
      expect(item.levels, item.baseId).toContain(item.defaultLevel);
      expect(item.members[item.defaultLevel], item.baseId).toBeTruthy();
      expect(item.displayName, item.baseId).not.toMatch(EFFORT_WORD);
      expect(item.fast, item.baseId).toBe(item.baseId.endsWith('-fast'));
      expect(Object.keys(item.members).sort(), item.baseId).toEqual([...item.levels].sort());

      for (const level of item.levels) {
        const parsed = parseCursorModelId(item.members[level]!);
        expect(parsed.baseId, item.members[level]).toBe(item.baseId);
        if (parsed.effort === null) expect(level, item.members[level]).toBe('medium');
        else expect(parsed.effort, item.members[level]).toBe(level);
      }
    }
  });

  it('collapses the cases the contract calls out', () => {
    expect(group('grok-4.7')).toMatchObject({
      defaultLevel: 'high',
      displayName: 'Grok 4.7',
      fast: false,
      levels: ['low', 'medium', 'high', 'xhigh'],
    });
    expect(group('grok-4.7-fast')).toMatchObject({
      defaultLevel: 'high',
      displayName: 'Grok 4.7 Fast',
      fast: true,
      levels: ['low', 'medium', 'high', 'xhigh'],
    });
    expect(group('claude-opus-5-5')).toMatchObject({
      defaultLevel: 'medium',
      displayName: 'Claude Opus 5.5 1M',
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      members: { medium: 'claude-opus-5-5-medium' },
    });
    expect(group('gpt-5.5').levels).toContain('xhigh');
    expect(group('gpt-5.5').members.xhigh).toBe('gpt-5.5-extra-high');
    expect(group('gpt-5.5-fast').members.xhigh).toBe('gpt-5.5-extra-high-fast');
    expect(group('claude-4.6-opus-thinking')).toMatchObject({
      levels: ['high', 'max'],
      members: {
        high: 'claude-4.6-opus-high-thinking',
        max: 'claude-4.6-opus-max-thinking',
      },
    });
    expect(group('gpt-5.3-codex')).toMatchObject({
      defaultLevel: 'medium',
      displayName: 'Codex 5.3',
      levels: ['low', 'medium', 'high', 'xhigh'],
      members: { medium: 'gpt-5.3-codex' },
    });
    expect(group('kimi-k3')).toMatchObject({
      defaultLevel: 'max',
      displayName: 'Kimi K3',
      levels: ['low', 'high', 'max'],
      members: { max: 'kimi-k3-max' },
    });
    expect(group('claude-fable-5').displayName).toBe('Claude Fable 5 1M (NO ZDR)');
    expect(group('claude-opus-4-7').defaultLevel).toBe('xhigh');
    expect(group('gpt-5.2').members.medium).toBe('gpt-5.2');
    expect(group('gpt-5.2-fast').members.medium).toBe('gpt-5.2-fast');

    const singleIds = grouped.singles.map((item) => item.id);
    expect(singleIds).toEqual(
      expect.arrayContaining([
        'auto',
        'composer-2.5',
        'composer-2.5-fast',
        'claude-4.6-sonnet-medium',
        'claude-4.6-sonnet-medium-thinking',
        'claude-4.5-opus-high',
      ]),
    );
    expect(grouped.groups.some((item) => item.baseId === 'composer-2.5')).toBe(false);
  });

  it('uses the middle level when high and medium are both absent', () => {
    const { groups } = groupCursorModels([
      { id: 'edge-low', name: 'Edge Low' },
      { id: 'edge-max', name: 'Edge Max' },
    ]);
    expect(groups[0]).toMatchObject({
      defaultLevel: 'max',
      levels: ['low', 'max'],
    });
  });
});

describe('resolveCursorModelId', () => {
  it('resolves exact, nearest, and tie-to-stronger', () => {
    expect(resolveCursorModelId(LIVE_IDS, 'grok-4.7', 'low')).toBe('grok-4.7-low');
    expect(resolveCursorModelId(LIVE_IDS, 'grok-4.7', 'max')).toBe('grok-4.7-xhigh');
    expect(resolveCursorModelId(LIVE_IDS, 'gpt-5.5', 'xhigh')).toBe('gpt-5.5-extra-high');
    expect(resolveCursorModelId(LIVE_IDS, 'grok-4.7-fast', 'low')).toBe('grok-4.7-low-fast');
    expect(resolveCursorModelId(LIVE_IDS, 'gpt-5.3-codex', 'high')).toBe('gpt-5.3-codex-high');
    expect(resolveCursorModelId(LIVE_IDS, 'gpt-5.3-codex', 'medium')).toBe('gpt-5.3-codex');
    expect(resolveCursorModelId(['only-low', 'only-high'], 'only', 'medium')).toBe('only-high');
    expect(resolveCursorModelId(['span-none', 'span-max'], 'span', 'medium')).toBe('span-max');
  });

  it('uses the default member, and passes legacy and unknown ids through', () => {
    expect(resolveCursorModelId(LIVE_IDS, 'grok-4.7')).toBe('grok-4.7-high');
    expect(resolveCursorModelId(LIVE_IDS, 'grok-4.7', null)).toBe('grok-4.7-high');
    expect(resolveCursorModelId(LIVE, 'claude-opus-5-5')).toBe('claude-opus-5-5-medium');
    expect(resolveCursorModelId(LIVE, 'kimi-k3')).toBe('kimi-k3-max');
    expect(resolveCursorModelId(LIVE_IDS, 'grok-4.7-high', 'low')).toBe('grok-4.7-high');
    expect(resolveCursorModelId(LIVE_IDS, 'composer-2.5', 'high')).toBe('composer-2.5');
    expect(resolveCursorModelId(LIVE_IDS, 'not-a-listed-model', 'high')).toBe('not-a-listed-model');
  });
});
