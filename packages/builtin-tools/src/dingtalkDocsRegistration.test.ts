import { DingtalkDocsIdentifier, DingtalkDocsManifest } from '@lobechat/builtin-tool-dingtalk-docs';
import { describe, expect, it } from 'vitest';

import { builtinToolIdentifiers } from './identifiers';
import { builtinTools } from './index';

describe('lobe-dingtalk-docs registration', () => {
  it('lists the tool once among builtin identifiers', () => {
    expect(DingtalkDocsIdentifier).toBe('lobe-dingtalk-docs');
    expect(builtinToolIdentifiers.filter((id) => id === DingtalkDocsIdentifier)).toEqual([
      DingtalkDocsIdentifier,
    ]);
  });

  it('publishes the manifest with the Chinese title', () => {
    const tool = builtinTools.find((item) => item.identifier === DingtalkDocsIdentifier);

    expect(tool?.type).toBe('builtin');
    expect(tool?.manifest).toBe(DingtalkDocsManifest);
    expect(tool?.title).toBe('钉钉文档与表格');
    expect(tool?.hidden).toBeUndefined();
  });
});
