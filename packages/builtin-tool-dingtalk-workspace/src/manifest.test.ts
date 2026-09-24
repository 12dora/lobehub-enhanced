import { BuiltinToolManifestSchema } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { DingtalkWorkspaceManifest } from './manifest';
import { DingtalkWorkspaceApiName, DingtalkWorkspaceWriteApiNames } from './types';

describe('DingtalkWorkspaceManifest', () => {
  it('matches the builtin tool manifest schema', () => {
    const parsed = BuiltinToolManifestSchema.safeParse(DingtalkWorkspaceManifest);

    expect(parsed.success).toBe(true);
  });

  it('uses the stable lobe-dingtalk-workspace identifier and required APIs', () => {
    expect(DingtalkWorkspaceManifest.identifier).toBe('lobe-dingtalk-workspace');
    expect(DingtalkWorkspaceManifest.type).toBe('builtin');
    expect(DingtalkWorkspaceManifest.api.map((item) => item.name).sort()).toEqual(
      Object.values(DingtalkWorkspaceApiName).slice().sort(),
    );
  });

  it('sets humanIntervention always on every write API and never on reads', () => {
    const writes = new Set<string>(DingtalkWorkspaceWriteApiNames);
    for (const api of DingtalkWorkspaceManifest.api) {
      if (writes.has(api.name)) {
        expect(api.humanIntervention).toBe('always');
      } else {
        expect(api.humanIntervention).toBe('never');
      }
    }
  });

  it('rejects extra properties on createTodo and createEvent', () => {
    const createTodo = DingtalkWorkspaceManifest.api.find(
      (item) => item.name === DingtalkWorkspaceApiName.createTodo,
    );
    const createEvent = DingtalkWorkspaceManifest.api.find(
      (item) => item.name === DingtalkWorkspaceApiName.createEvent,
    );

    expect(createTodo?.parameters.required).toEqual(['subject']);
    expect(createTodo?.parameters.additionalProperties).toBe(false);
    expect(createEvent?.parameters.required).toEqual(['summary', 'start', 'end']);
    expect(createEvent?.parameters.additionalProperties).toBe(false);
  });

  it('exposes searchDirectory q and optional kind', () => {
    const search = DingtalkWorkspaceManifest.api.find(
      (item) => item.name === DingtalkWorkspaceApiName.searchDirectory,
    );

    expect(search?.parameters.required).toEqual(['q']);
    expect(search?.parameters.properties.kind.enum).toEqual(['department', 'user']);
    expect(search?.description).toContain('verbatim');
  });

  it('caps queryFreeBusy staffTokens at 20', () => {
    const freeBusy = DingtalkWorkspaceManifest.api.find(
      (item) => item.name === DingtalkWorkspaceApiName.queryFreeBusy,
    );

    expect(freeBusy?.parameters.required).toEqual(['staffTokens', 'from', 'to']);
    expect(freeBusy?.parameters.properties.staffTokens.maxItems).toBe(20);
    expect(freeBusy?.description).toContain('busy/free');
  });

  it('describes personalTodos on listTodos as read-only', () => {
    const listTodos = DingtalkWorkspaceManifest.api.find(
      (item) => item.name === DingtalkWorkspaceApiName.listTodos,
    );

    expect(listTodos?.description).toContain('personalTodos');
    expect(listTodos?.description).toContain('lobe-dingtalk-personal');
    expect(listTodos?.description).toContain('updateTodo/completeTodo');
    expect(listTodos?.description).toContain(
      'notes 里的 markdown 链接必须原样转告，不要改写或编造 URL',
    );
    expect(listTodos?.parameters.properties.refresh.description).toContain('personalTodos');
  });

  it('lets updateTodo clear dueTime and send up to 1000 executors', () => {
    const updateTodo = DingtalkWorkspaceManifest.api.find(
      (item) => item.name === DingtalkWorkspaceApiName.updateTodo,
    );

    expect(updateTodo?.parameters.properties.dueTime.type).toEqual(['string', 'null']);
    expect(updateTodo?.parameters.properties.executorTokens.maxItems).toBe(1000);
  });
});
