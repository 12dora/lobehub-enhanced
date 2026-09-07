import { describe, expect, it } from 'vitest';

import { renderLocalPreinstalledSoftware } from './preinstalled';
import { cloudPreinstalledSoftware, resolvePreinstalledSoftwarePrompt } from './preinstalledCloud';
import { systemPrompt } from './systemRole';

describe('systemPrompt', () => {
  it('contains both sandbox placeholders', () => {
    expect(systemPrompt).toContain('{{sandbox_uploaded_files}}');
    expect(systemPrompt).toContain('{{sandbox_preinstalled_software}}');
  });

  it('does not hardcode a cloud-only provider or image', () => {
    expect(systemPrompt).not.toContain('AWS Bedrock AgentCore');
    expect(systemPrompt).not.toContain('lobehubbot/python-node');
    expect(systemPrompt).not.toContain('<preinstalled_software>');
    expect(systemPrompt).toContain("isolated container separate from the user's device");
  });
});

describe('resolvePreinstalledSoftwarePrompt', () => {
  it('returns the local image description when provider is local', () => {
    const result = resolvePreinstalledSoftwarePrompt('local');

    expect(result).toBe(renderLocalPreinstalledSoftware());
    expect(result).toContain('Dockerfile.sandbox');
    expect(result).not.toContain('lobehubbot/python-node');
  });

  it('returns the cloud image description for every other provider', () => {
    expect(resolvePreinstalledSoftwarePrompt('market')).toBe(cloudPreinstalledSoftware);
    expect(resolvePreinstalledSoftwarePrompt('onlyboxes')).toBe(cloudPreinstalledSoftware);
    expect(resolvePreinstalledSoftwarePrompt(undefined)).toBe(cloudPreinstalledSoftware);
    expect(resolvePreinstalledSoftwarePrompt(null)).toBe(cloudPreinstalledSoftware);
    expect(cloudPreinstalledSoftware).toContain('lobehubbot/python-node');
    expect(cloudPreinstalledSoftware).toContain('<preinstalled_software>');
  });
});
