import { BuiltinToolManifestSchema } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { EnterpriseLookupManifest } from './manifest';
import { EnterpriseLookupApiName } from './types';

describe('EnterpriseLookupManifest', () => {
  it('matches the builtin tool manifest schema', () => {
    const parsed = BuiltinToolManifestSchema.safeParse(EnterpriseLookupManifest);

    expect(parsed.success).toBe(true);
  });

  it('uses the stable identifier, never-intervene APIs, and required names', () => {
    expect(EnterpriseLookupManifest.identifier).toBe('lobe-enterprise-lookup');
    expect(EnterpriseLookupManifest.type).toBe('builtin');
    expect(EnterpriseLookupManifest.humanIntervention).toBe('never');
    expect(EnterpriseLookupManifest.api.map((item) => item.name).sort()).toEqual(
      Object.values(EnterpriseLookupApiName).slice().sort(),
    );
    expect(EnterpriseLookupManifest.api.every((item) => item.humanIntervention === 'never')).toBe(
      true,
    );
  });

  it('requires capability on queryEnterprise and keeps extra properties closed', () => {
    const query = EnterpriseLookupManifest.api.find(
      (item) => item.name === EnterpriseLookupApiName.queryEnterprise,
    );

    expect(query?.parameters.required).toEqual(['capability']);
    expect(query?.parameters.additionalProperties).toBe(false);
    expect(query?.parameters.properties.provider.enum).toEqual(['qcc', 'tianyancha']);
    expect(query?.description).toContain('never guess');
    expect(query?.description).toContain('paid quota');
  });

  it('exposes optional provider and category on listCapabilities', () => {
    const list = EnterpriseLookupManifest.api.find(
      (item) => item.name === EnterpriseLookupApiName.listCapabilities,
    );

    expect(list?.parameters.required).toEqual([]);
    expect(list?.parameters.properties.provider.enum).toEqual(['qcc', 'tianyancha']);
    expect(list?.description).toContain('inputSchema');
    expect(list?.description).toContain('companyProfile');
  });

  it('requires name on companyProfile and keeps extra properties closed', () => {
    const api = EnterpriseLookupManifest.api.find(
      (item) => item.name === EnterpriseLookupApiName.companyProfile,
    );

    expect(api?.humanIntervention).toBe('never');
    expect(api?.parameters.required).toEqual(['name']);
    expect(api?.parameters.additionalProperties).toBe(false);
    expect(api?.parameters.properties.aspects.items.enum).toEqual([
      'basic',
      'ipr',
      'people',
      'risk',
    ]);
    expect(api?.description).toContain('unique');
    expect(api?.description).toContain('paid quota');
  });
});
