import { describe, expect, it } from 'vitest';

import { EnterpriseLookupManifest } from './manifest';
import { systemPrompt } from './systemRole';

describe('enterprise lookup systemRole', () => {
  it('is attached to the manifest', () => {
    expect(EnterpriseLookupManifest.systemRole).toBe(systemPrompt);
  });

  it('is written in English', () => {
    expect(systemPrompt.startsWith('You look up')).toBe(true);
  });

  it('asks the user when the company match is ambiguous and never guesses', () => {
    expect(systemPrompt).toContain('企业名称 · 统一社会信用代码 · 法定代表人 · 状态');
    expect(systemPrompt).toContain('never guess');
    expect(systemPrompt).toContain('ask the user to choose');
  });

  it('names the data provider and stays frugal with paid calls', () => {
    expect(systemPrompt).toContain('企查查');
    expect(systemPrompt).toContain('天眼查');
    expect(systemPrompt).toContain('paid quota');
    expect(systemPrompt).toContain('Do not repeat identical queries');
    expect(systemPrompt).toContain('fan out');
  });

  it('retries once on PROVIDER_UNAVAILABLE fallback', () => {
    expect(systemPrompt).toContain('ENTERPRISE_LOOKUP_PROVIDER_UNAVAILABLE');
    expect(systemPrompt).toContain('fallbackProvider');
    expect(systemPrompt).toContain('retry companyProfile once');
    expect(systemPrompt).toContain('Do not retry further');
  });

  it('documents companyProfile first and the long-tail APIs', () => {
    expect(systemPrompt).toContain('companyProfile');
    expect(systemPrompt).toContain('Call companyProfile first');
    expect(systemPrompt).toContain('listCapabilities');
    expect(systemPrompt).toContain('Never call listCapabilities twice');
    expect(systemPrompt).toContain('queryEnterprise');
  });

  it('requires two-column markdown tables and a source line', () => {
    expect(systemPrompt).toContain('| 项目 | 内容 |');
    expect(systemPrompt).toContain('基本信息');
    expect(systemPrompt).toContain('股东与高管');
    expect(systemPrompt).toContain('No long prose paragraphs');
    expect(systemPrompt).toContain('60 characters');
    expect(systemPrompt).toContain('first 8');
    expect(systemPrompt).toContain('Omit empty fields');
    expect(systemPrompt).toContain('query time');
  });
});
