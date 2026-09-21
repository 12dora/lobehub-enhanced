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
    expect(systemPrompt).toContain('企业名称 · 统一社会信用代码/法定代表人');
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
    expect(systemPrompt).toContain('listCapabilities');
    expect(systemPrompt).toContain('retry queryEnterprise once');
    expect(systemPrompt).toContain('Do not retry further');
  });

  it('documents both APIs', () => {
    expect(systemPrompt).toContain('listCapabilities');
    expect(systemPrompt).toContain('queryEnterprise');
  });
});
