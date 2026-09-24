import { describe, expect, it } from 'vitest';

import { DingtalkDocsManifest } from './manifest';
import { systemPrompt } from './systemRole';

describe('dingtalk docs systemRole', () => {
  it('is attached to the manifest and is Chinese', () => {
    expect(DingtalkDocsManifest.systemRole).toBe(systemPrompt);
    expect(systemPrompt).toContain('钉钉文档与表格');
    expect(systemPrompt).toContain('当前用户本人');
    expect(systemPrompt).not.toMatch(/You have DingTalk/);
  });

  it('searches, then asks, then reads', () => {
    expect(systemPrompt).toContain('先搜索或列出');
    expect(systemPrompt).toContain('不要猜测');
    expect(systemPrompt).toContain('再阅读');
  });

  it('separates online sheets, AI tables, and ordinary Drive files', () => {
    expect(systemPrompt).toContain('在线表格');
    expect(systemPrompt).toContain('listSheets');
    expect(systemPrompt).toContain('readSheet');
    expect(systemPrompt).toContain('appendSheetRows');
    expect(systemPrompt).toContain('AI 表格');
    expect(systemPrompt).toContain('searchAitableBases');
    expect(systemPrompt).toContain('getAitableSchema');
    expect(systemPrompt).toContain('queryAitableRecords');
    expect(systemPrompt).toContain('downloadDriveFile');
    expect(systemPrompt).toContain('不能当普通文件下载');
  });

  it('clips an omitted sheet range and writes with schema field ids', () => {
    expect(systemPrompt).toContain('省略 range');
    expect(systemPrompt).toContain('任意 A1');
    expect(systemPrompt).toContain('AE1:AO14');
    expect(systemPrompt).toContain('200 行');
    expect(systemPrompt).toContain('30 列');
    expect(systemPrompt).toContain('fieldId');
    expect(systemPrompt).toContain('不要自造记录或字段 id');
  });

  it('puts every row or record in one write and treats the card as confirmation', () => {
    expect(systemPrompt).toContain('一次写入');
    expect(systemPrompt).toContain('appendDoc');
    expect(systemPrompt).toContain('createDoc');
    expect(systemPrompt).toContain('createAitableRecords');
    expect(systemPrompt).toContain('updateAitableRecords');
    expect(systemPrompt).toContain('不要拆开或并行多次调用');
    expect(systemPrompt).toContain('约 50 KB');
    expect(systemPrompt).toContain('确认卡片就是用户的确认，不要在文字里再问一次');
  });

  it('relays authorization and admin links verbatim', () => {
    expect(systemPrompt).toContain('授权或管理员未开启的说明和链接必须原样转发');
    expect(systemPrompt).toContain('不要改写、截断或编造 URL');
  });
});
