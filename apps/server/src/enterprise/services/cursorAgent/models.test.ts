// @vitest-environment node
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CURSOR_AGENT_STATE_DIR_ENV } from './env';
import {
  cursorLastKnownGoodModelListPath,
  CursorModelListSkippedError,
  getCachedCursorModels,
  loadCursorModelsOnce,
  parseCursorModelList,
  resetCursorModelsCache,
  resolveCachedCursorModelId,
  setCachedCursorModels,
} from './models';
import { isCursorModelId } from './transport.parseTurn';

const TOKEN = 'cursor-model-cache-token';

const LIVE = [
  { id: 'grok-4.7-low', name: 'Grok 4.7 Low' },
  { id: 'grok-4.7-high', name: 'Grok 4.7' },
  { id: 'grok-4.7-xhigh', name: 'Grok 4.7 Extra High' },
  { id: 'cursor-grok-4.6-high', name: 'Grok 4.6' },
];

afterEach(() => {
  resetCursorModelsCache();
});

describe('parseCursorModelList', () => {
  it('parses id/name lines and strips (current)/(default) suffixes', () => {
    const models = parseCursorModelList(`Available models

auto - Auto (default)
composer-2.5 - Composer 2.5
cursor-grok-4.6-high - Cursor Grok 4.6 High (current)
not a model line
`);

    expect(models).toEqual([
      { id: 'auto', name: 'Auto' },
      { id: 'composer-2.5', name: 'Composer 2.5' },
      { id: 'cursor-grok-4.6-high', name: 'Cursor Grok 4.6 High' },
    ]);
  });

  it('strips zero-width characters and collapses repeated whitespace in ids and names', () => {
    const models = parseCursorModelList(
      [
        'grok-4.7-low - Grok 4.7  Low',
        'grok-4.7-high-fast - Grok 4.7  High Fast\u200B\u200B',
        'grok-4.7-medium\u200B - Grok\uFEFF 4.7\t\tMedium',
      ].join('\n'),
    );

    expect(models).toEqual([
      { id: 'grok-4.7-low', name: 'Grok 4.7 Low' },
      { id: 'grok-4.7-high-fast', name: 'Grok 4.7 High Fast' },
      { id: 'grok-4.7-medium', name: 'Grok 4.7 Medium' },
    ]);
  });
});

describe('resolveCachedCursorModelId', () => {
  it('maps a base id plus effort onto the concrete cached member', () => {
    setCachedCursorModels(TOKEN, LIVE);

    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7', 'high')).toBe('grok-4.7-high');
  });

  it('leaves a legacy concrete id unchanged', () => {
    setCachedCursorModels(TOKEN, LIVE);

    expect(resolveCachedCursorModelId(TOKEN, 'cursor-grok-4.6-high', 'low')).toBe(
      'cursor-grok-4.6-high',
    );
  });

  it('uses the group default when a base id is sent with no effort', () => {
    setCachedCursorModels(TOKEN, [
      { id: 'grok-4.7-low', name: 'Grok 4.7 Low' },
      { id: 'grok-4.7-medium', name: 'Grok 4.7 Medium' },
      { id: 'grok-4.7-high', name: 'Grok 4.7 High' },
      { id: 'grok-4.7-xhigh', name: 'Grok 4.7 Extra High' },
      { id: 'gpt-5.3-codex-low', name: 'Codex 5.3 Low' },
      { id: 'gpt-5.3-codex', name: 'Codex 5.3' },
      { id: 'gpt-5.3-codex-high', name: 'Codex 5.3 High' },
      { id: 'gpt-5.3-codex-xhigh', name: 'Codex 5.3 Extra High' },
    ]);

    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7')).toBe('grok-4.7-high');
    expect(resolveCachedCursorModelId(TOKEN, 'gpt-5.3-codex')).toBe('gpt-5.3-codex');
  });

  it('resolves from listed member ids instead of inventing a contradictory suffix', () => {
    setCachedCursorModels(TOKEN, [
      { id: 'gpt-5.5-high', name: 'GPT-5.5 High' },
      { id: 'gpt-5.5-extra-high', name: 'GPT-5.5 Extra High' },
      { id: 'claude-4.6-opus-high-thinking', name: 'Opus 4.6 High Thinking' },
    ]);

    expect(resolveCachedCursorModelId(TOKEN, 'gpt-5.5', 'xhigh')).toBe('gpt-5.5-extra-high');
    expect(resolveCachedCursorModelId(TOKEN, 'claude-4.6-opus-thinking')).toBe(
      'claude-4.6-opus-high-thinking',
    );
    expect(resolveCachedCursorModelId(TOKEN, 'claude-4.6-opus-thinking', 'max')).toBe(
      'claude-4.6-opus-high-thinking',
    );
  });

  it('uses the CLI name to pick the default level when no effort is sent', () => {
    setCachedCursorModels(TOKEN, [
      { id: 'claude-opus-5-5-low', name: 'Claude Opus 5.5 1M Low' },
      { id: 'claude-opus-5-5-medium', name: 'Claude Opus 5.5 1M' },
      { id: 'claude-opus-5-5-high', name: 'Claude Opus 5.5 1M High' },
      { id: 'claude-opus-5-5-xhigh', name: 'Claude Opus 5.5 1M Extra High' },
      { id: 'claude-opus-5-5-max', name: 'Claude Opus 5.5 1M Max' },
    ]);

    expect(resolveCachedCursorModelId(TOKEN, 'claude-opus-5-5')).toBe('claude-opus-5-5-medium');
  });

  it('passes an unknown id through unchanged', () => {
    setCachedCursorModels(TOKEN, LIVE);

    expect(resolveCachedCursorModelId(TOKEN, 'not-a-listed-model', 'high')).toBe(
      'not-a-listed-model',
    );
  });

  it('synthesizes a concrete id when the live list is missing or expired', () => {
    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7', 'high')).toBe('grok-4.7-high');
    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7-fast', 'xhigh')).toBe('grok-4.7-xhigh-fast');
    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7')).toBe('grok-4.7');
    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7-low', 'xhigh')).toBe('grok-4.7-low');

    setCachedCursorModels(TOKEN, LIVE, Date.now() - 10 * 60 * 1000 - 1000);
    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7', 'high')).toBe('grok-4.7-high');
  });

  it('leaves single-level bank ids unchanged when the live list is missing', () => {
    expect(resolveCachedCursorModelId(TOKEN, 'composer-2.5')).toBe('composer-2.5');
    expect(resolveCachedCursorModelId(TOKEN, 'composer-2.5', 'high')).toBe('composer-2.5');
  });

  it('does not append an effort to an id with no version-like digit', () => {
    // No live list. `auto` and `composer` have no version digit, so an effort
    // is not invented. An id that still has a digit can take an explicit effort.
    expect(resolveCachedCursorModelId(TOKEN, 'auto')).toBe('auto');
    expect(resolveCachedCursorModelId(TOKEN, 'auto', 'high')).toBe('auto');
    expect(resolveCachedCursorModelId(TOKEN, 'composer', 'high')).toBe('composer');
    expect(resolveCachedCursorModelId(TOKEN, 'gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(resolveCachedCursorModelId(TOKEN, 'kimi-k3')).toBe('kimi-k3');
    expect(resolveCachedCursorModelId(TOKEN, 'gpt-5.6-sol', 'high')).toBe('gpt-5.6-sol-high');
  });

  it('does not keep an empty parse in the cache', () => {
    setCachedCursorModels(TOKEN, []);
    expect(getCachedCursorModels(TOKEN)).toBeUndefined();
  });

  it('uses the bank default level for a collapsed base when no effort is sent', () => {
    expect(resolveCachedCursorModelId(TOKEN, 'cursor-grok-4.6')).toBe('cursor-grok-4.6-high');
    expect(resolveCachedCursorModelId(TOKEN, 'cursor-grok-4.6-fast')).toBe(
      'cursor-grok-4.6-high-fast',
    );
    expect(resolveCachedCursorModelId(TOKEN, 'cursor-grok-4.6-fast', 'xhigh')).toBe(
      'cursor-grok-4.6-xhigh-fast',
    );
    expect(resolveCachedCursorModelId(TOKEN, 'claude-opus-5-thinking')).toBe(
      'claude-opus-5-thinking-high',
    );
    expect(resolveCachedCursorModelId(TOKEN, 'claude-sonnet-5-thinking')).toBe(
      'claude-sonnet-5-thinking-high',
    );
    expect(resolveCachedCursorModelId(TOKEN, 'gemini-3.7-flash')).toBe('gemini-3.7-flash-high');
    expect(resolveCachedCursorModelId(TOKEN, 'cursor-grok-4.5')).toBe('cursor-grok-4.5-high');
  });
});

describe('loadCursorModelsOnce', () => {
  it('runs one loader for concurrent callers and then serves the cache', async () => {
    let calls = 0;
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = () => resolve();
    });

    const load = async () => {
      calls += 1;
      await held;
      setCachedCursorModels(TOKEN, LIVE);
      return LIVE;
    };

    const first = loadCursorModelsOnce(TOKEN, load);
    const second = loadCursorModelsOnce(TOKEN, load);
    expect(calls).toBe(1);
    release();
    await expect(first).resolves.toEqual(LIVE);
    await expect(second).resolves.toEqual(LIVE);

    await loadCursorModelsOnce(TOKEN, load);
    expect(calls).toBe(1);
  });

  it('remembers a real CLI failure for 60 seconds and then retries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-25T00:00:00.000Z'));
      let calls = 0;
      const load = async () => {
        calls += 1;
        return undefined;
      };

      await expect(loadCursorModelsOnce(TOKEN, load)).resolves.toBeUndefined();
      vi.setSystemTime(new Date('2026-09-25T00:00:59.000Z'));
      await expect(loadCursorModelsOnce(TOKEN, load)).resolves.toBeUndefined();
      expect(calls).toBe(1);

      vi.setSystemTime(new Date('2026-09-25T00:01:00.000Z'));
      await expect(loadCursorModelsOnce(TOKEN, load)).resolves.toBeUndefined();
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not remember a gate skip or an abort', async () => {
    let skipped = 0;
    const skip = async () => {
      skipped += 1;
      throw new CursorModelListSkippedError();
    };
    await expect(loadCursorModelsOnce(TOKEN, skip)).resolves.toBeUndefined();
    await expect(loadCursorModelsOnce(TOKEN, skip)).resolves.toBeUndefined();
    expect(skipped).toBe(2);

    resetCursorModelsCache();
    let aborted = 0;
    const abort = async () => {
      aborted += 1;
      throw new DOMException('The operation was aborted.', 'AbortError');
    };
    await expect(loadCursorModelsOnce(TOKEN, abort)).resolves.toBeUndefined();
    await expect(loadCursorModelsOnce(TOKEN, abort)).resolves.toBeUndefined();
    expect(aborted).toBe(2);
  });
});

describe('last-known-good model list', () => {
  let stateDir = '';
  const previousState = process.env[CURSOR_AGENT_STATE_DIR_ENV];

  afterEach(() => {
    if (previousState === undefined) delete process.env[CURSOR_AGENT_STATE_DIR_ENV];
    else process.env[CURSOR_AGENT_STATE_DIR_ENV] = previousState;
    if (stateDir) rmSync(stateDir, { force: true, recursive: true });
  });

  it('resolves from the on-disk snapshot when the memory cache is cold', () => {
    stateDir = mkdtempSync(join(tmpdir(), 'cursor-models-'));
    process.env[CURSOR_AGENT_STATE_DIR_ENV] = stateDir;
    const file = cursorLastKnownGoodModelListPath(stateDir, TOKEN);
    mkdirSync(join(stateDir, 'model-lists'), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        models: [
          { id: 'grok-4.7-low', name: 'Grok 4.7 Low' },
          { id: 'grok-4.7-high', name: 'Grok 4.7 High' },
          { id: 'gpt-5.3-codex-low', name: 'Codex 5.3 Low' },
          { id: 'gpt-5.3-codex', name: 'Codex 5.3' },
          { id: 'gpt-5.3-codex-high', name: 'Codex 5.3 High' },
        ],
      }),
    );
    chmodSync(file, 0o600);

    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7')).toBe('grok-4.7-high');
    expect(resolveCachedCursorModelId(TOKEN, 'gpt-5.3-codex')).toBe('gpt-5.3-codex');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).not.toContain(TOKEN);
  });

  it('ignores an empty cache entry and still uses the saved list', () => {
    stateDir = mkdtempSync(join(tmpdir(), 'cursor-models-'));
    process.env[CURSOR_AGENT_STATE_DIR_ENV] = stateDir;
    const file = cursorLastKnownGoodModelListPath(stateDir, TOKEN);
    mkdirSync(join(stateDir, 'model-lists'), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        models: [
          { id: 'grok-4.7-low', name: 'Grok 4.7 Low' },
          { id: 'grok-4.7-high', name: 'Grok 4.7' },
        ],
      }),
    );
    setCachedCursorModels(TOKEN, []);

    expect(getCachedCursorModels(TOKEN)).toBeUndefined();
    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7')).toBe('grok-4.7-high');
  });

  it('uses the newest list file on this host when this token has none', () => {
    stateDir = mkdtempSync(join(tmpdir(), 'cursor-models-'));
    process.env[CURSOR_AGENT_STATE_DIR_ENV] = stateDir;
    const dir = join(stateDir, 'model-lists');
    mkdirSync(dir, { recursive: true });
    const older = join(dir, `${'a'.repeat(64)}.json`);
    const newer = join(dir, `${'b'.repeat(64)}.json`);
    writeFileSync(
      older,
      JSON.stringify({ models: [{ id: 'composer-2.5', name: 'Composer 2.5' }] }),
    );
    writeFileSync(
      newer,
      JSON.stringify({
        models: [
          { id: 'grok-4.7-low', name: 'Grok 4.7 Low' },
          { id: 'grok-4.7-high', name: 'Grok 4.7' },
        ],
      }),
    );
    const day = 24 * 60 * 60 * 1000;
    utimesSync(older, new Date(Date.now() - 2 * day), new Date(Date.now() - 2 * day));
    utimesSync(newer, new Date(Date.now() - 60 * 1000), new Date(Date.now() - 60 * 1000));

    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7')).toBe('grok-4.7-high');
  });

  it('prefers this token file over a newer list written for another token', () => {
    stateDir = mkdtempSync(join(tmpdir(), 'cursor-models-'));
    process.env[CURSOR_AGENT_STATE_DIR_ENV] = stateDir;
    const dir = join(stateDir, 'model-lists');
    mkdirSync(dir, { recursive: true });
    const own = cursorLastKnownGoodModelListPath(stateDir, TOKEN);
    const newer = join(dir, `${'c'.repeat(64)}.json`);
    writeFileSync(
      own,
      JSON.stringify({
        models: [
          { id: 'grok-4.7-low', name: 'Grok 4.7 Low' },
          { id: 'grok-4.7-high', name: 'Grok 4.7' },
        ],
      }),
    );
    writeFileSync(
      newer,
      JSON.stringify({ models: [{ id: 'composer-2.5', name: 'Composer 2.5' }] }),
    );
    const day = 24 * 60 * 60 * 1000;
    utimesSync(own, new Date(Date.now() - 2 * day), new Date(Date.now() - 2 * day));
    utimesSync(newer, new Date(Date.now() - 60 * 1000), new Date(Date.now() - 60 * 1000));

    expect(resolveCachedCursorModelId(TOKEN, 'grok-4.7')).toBe('grok-4.7-high');
  });

  it('treats an empty load as a 60 second failure and still serves the saved list', async () => {
    stateDir = mkdtempSync(join(tmpdir(), 'cursor-models-'));
    process.env[CURSOR_AGENT_STATE_DIR_ENV] = stateDir;
    const file = cursorLastKnownGoodModelListPath(stateDir, TOKEN);
    mkdirSync(join(stateDir, 'model-lists'), { recursive: true });
    const saved = [
      { id: 'grok-4.7-low', name: 'Grok 4.7 Low' },
      { id: 'grok-4.7-high', name: 'Grok 4.7' },
    ];
    writeFileSync(file, JSON.stringify({ models: saved }));

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-25T00:00:00.000Z'));
      let calls = 0;
      const load = async () => {
        calls += 1;
        return [];
      };

      await expect(loadCursorModelsOnce(TOKEN, load)).resolves.toEqual(saved);
      vi.setSystemTime(new Date('2026-09-25T00:00:59.000Z'));
      await expect(loadCursorModelsOnce(TOKEN, load)).resolves.toEqual(saved);
      expect(calls).toBe(1);

      vi.setSystemTime(new Date('2026-09-25T00:01:00.000Z'));
      await expect(loadCursorModelsOnce(TOKEN, load)).resolves.toEqual(saved);
      expect(calls).toBe(2);
      expect(getCachedCursorModels(TOKEN)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isCursorModelId', () => {
  it('accepts a concrete cursor id and rejects one that must not reach --model', () => {
    expect(isCursorModelId('grok-4.7-high')).toBe(true);
    expect(isCursorModelId('bad id')).toBe(false);
    expect(isCursorModelId('')).toBe(false);
  });
});
