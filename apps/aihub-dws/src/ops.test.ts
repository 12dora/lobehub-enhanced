import { describe, expect, it } from 'vitest';

import { BrokerError } from './errors.ts';
import { OP_NAMES, opWrites, prepareExec } from './ops.ts';

const PROFILE = 'dingcorp0123456789:012345678901234567';
const DAY = 24 * 60 * 60 * 1000;

function prep(op: string, args: Record<string, unknown> = {}) {
  return prepareExec(op, PROFILE, args);
}

function argsOf(op: string, args: Record<string, unknown> = {}) {
  const prepared = prep(op, args);
  expect(prepared.argv.slice(0, 1)).toEqual([`--profile=${PROFILE}`]);
  expect(prepared.argv.slice(-2)).toEqual(['--format=json', '--timeout=30']);
  return prepared.argv.slice(1, -2);
}

describe('op allowlist', () => {
  it('covers every contract op and the write set', () => {
    expect([...OP_NAMES].sort()).toEqual(
      [
        'chat.downloadFile',
        'chat.messages',
        'chat.myGroups',
        'chat.searchGroups',
        'chat.searchMessages',
        'contact.self',
        'report.get',
        'report.inbox',
        'report.outbox',
        'report.submit',
        'report.template',
        'report.templates',
        'todo.complete',
        'todo.get',
        'todo.list',
        'todo.update',
      ].sort(),
    );
    expect(['todo.update', 'todo.complete', 'report.submit'].every((op) => opWrites(op))).toBe(
      true,
    );
    expect(opWrites('todo.list')).toBe(false);
  });

  it('builds todo argv with defaults', () => {
    expect(argsOf('todo.list')).toEqual([
      'todo',
      '+get-my-tasks',
      '--status=false',
      '--role-types=creator,executor,participant',
      '--page=1',
      '--size=20',
    ]);
    expect(argsOf('todo.list', { roleTypes: ['executor'], status: 'done' })).toEqual([
      'todo',
      '+get-my-tasks',
      '--status=true',
      '--role-types=executor',
      '--page=1',
      '--size=20',
    ]);
    expect(argsOf('todo.list', { status: 'all' })).not.toContain('--status=false');
    expect(argsOf('todo.get', { taskId: '57475254077' })).toEqual([
      'todo',
      '+get',
      '--task-id=57475254077',
    ]);
    expect(argsOf('todo.complete', { taskId: '57475254077' })).toEqual([
      'todo',
      '+complete',
      '--task-id=57475254077',
      '--yes',
    ]);
    expect(
      argsOf('todo.update', {
        due: '2026-09-24T00:00:00.000Z',
        priority: 20,
        taskId: '57475254077',
      }),
    ).toEqual([
      'todo',
      '+update',
      '--task-id=57475254077',
      '--due=2026-09-24T00:00:00.000Z',
      '--priority=20',
      '--yes',
    ]);
  });

  it('builds chat and report argv', () => {
    const start = '2026-09-17T00:00:00.000Z';
    const end = new Date(Date.parse(start) + 7 * DAY).toISOString();
    expect(
      argsOf('chat.messages', {
        conversationId: 'cidvO0I6uONXHnc51d6c8tnNA==',
        end,
        maxItems: 500,
        order: 'desc',
        start,
      }),
    ).toEqual([
      'chat',
      '+chat-messages',
      '--open-conversation-id=cidvO0I6uONXHnc51d6c8tnNA==',
      `--start=${start}`,
      `--end=${end}`,
      '--order=desc',
      '--page-all',
      '--page-limit=25',
      '--max-items=500',
    ]);
    const cursor = 'a'.repeat(300);
    expect(argsOf('chat.searchMessages', { cursor, query: '库存' })).toEqual([
      'chat',
      '+search-msg',
      '--query=库存',
      '--limit=20',
      `--cursor=${cursor}`,
    ]);
    expect(
      argsOf('chat.downloadFile', {
        resourceId: 'pGBa2Lm8aGX7ebA1szppBbEKVgN7R35y',
        resourceType: 'fileId',
      }),
    ).toEqual([
      'chat',
      '+messages-resource-download',
      '--type=fileId',
      '--resource-id=pGBa2Lm8aGX7ebA1szppBbEKVgN7R35y',
      '--output=./files/',
    ]);
    expect(
      prep('chat.downloadFile', { resourceId: 'abc', resourceType: 'mediaId' }).timeoutMs,
    ).toBe(100_000);
    const contents = [
      {
        content: '第一行\n第二行',
        contentType: 'markdown',
        key: '今日完成工作',
        sort: '0',
        type: '1',
      },
    ];
    const submitted = prep('report.submit', {
      contents,
      templateId: 'tpl1',
      toChat: true,
      toUserIds: ['0123', '4567'],
    });
    expect(
      argsOf('report.submit', {
        contents,
        templateId: 'tpl1',
        toChat: true,
        toUserIds: ['0123', '4567'],
      }),
    ).toEqual([
      'report',
      'entry',
      'submit',
      '--template-id=tpl1',
      '--contents=-',
      '--to-user-ids=0123,4567',
      '--to-chat',
      '--yes',
    ]);
    expect(submitted.stdin).toBe(JSON.stringify(contents));
    expect(argsOf('report.templates')).toEqual(['report', 'template', 'list']);
    expect(argsOf('report.template', { name: '日报' })).toEqual([
      'report',
      'template',
      'get',
      '--name=日报',
    ]);
    expect(argsOf('contact.self')).toEqual(['contact', 'user', 'get-self']);
  });

  it('rejects invalid args and unknown flags', () => {
    const start = '2026-09-01T00:00:00.000Z';
    const tooWide = new Date(Date.parse(start) + 7 * DAY + 1).toISOString();
    expect(() => prep('chat.messages', { conversationId: 'cid1', end: tooWide, start })).toThrow(
      BrokerError,
    );
    expect(() => prep('todo.get', { taskId: 'has space' })).toThrow(BrokerError);
    expect(() => prep('todo.get', { extra: true, taskId: 'abc' })).toThrow(/未知参数/);
    expect(() => prep('todo.update', { taskId: 'abc' })).toThrow(/至少修改一项/);
    expect(() => prep('chat.searchGroups', { query: 'a\nb' })).toThrow(BrokerError);
    expect(() => prep('chat.searchMessages', { cursor: 'a'.repeat(4097), query: 'x' })).toThrow(
      /游标/,
    );
    expect(() => prep('contact.self', { debug: true })).toThrow(BrokerError);
    expect(() => prepareExec('nope', PROFILE, {})).toThrow(BrokerError);
    expect(() => prepareExec('todo.list', 'not-a-profile', {})).toThrow(BrokerError);
    try {
      prep('todo.get', { taskId: 'x;rm' });
    } catch (error) {
      expect(error).toBeInstanceOf(BrokerError);
      expect((error as BrokerError).code).toBe('INVALID_ARGS');
      expect((error as BrokerError).message).not.toContain('rm');
    }
  });
});
