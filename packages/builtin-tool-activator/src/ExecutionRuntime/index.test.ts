import { describe, expect, it, vi } from 'vitest';

import {
  ActivatorExecutionRuntime,
  type ActivatorRuntimeService,
  LOCAL_SYSTEM_IDENTIFIER,
  LOCAL_SYSTEM_NO_DEVICE_MESSAGE,
  type ToolManifestInfo,
} from './index';

const localSystemManifest = (): ToolManifestInfo => ({
  apiDescriptions: [{ description: 'Run a shell command', name: 'runCommand' }],
  identifier: LOCAL_SYSTEM_IDENTIFIER,
  name: 'Local System',
  systemRole:
    '<device name="{{hostname}}" />\n<working-directory>{{workingDirectory}}</working-directory>',
});

const service = (overrides: Partial<ActivatorRuntimeService> = {}): ActivatorRuntimeService => ({
  getActivatedToolIds: () => [],
  getToolManifests: vi.fn(async () => [localSystemManifest()]),
  markActivated: vi.fn(),
  ...overrides,
});

describe('ActivatorExecutionRuntime.activateTools', () => {
  it('refuses lobe-local-system when the run has no active device', async () => {
    const runtimeService = service({ hasActiveDevice: () => false });
    const runtime = new ActivatorExecutionRuntime({ service: runtimeService });

    const result = await runtime.activateTools({
      identifiers: [LOCAL_SYSTEM_IDENTIFIER],
      reason: 'open a shell',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain(LOCAL_SYSTEM_NO_DEVICE_MESSAGE);
    expect(result.content).not.toContain('{{hostname}}');
    expect(result.content).not.toContain('{{workingDirectory}}');
    expect(result.state).toMatchObject({
      activatedTools: [],
      notFound: [LOCAL_SYSTEM_IDENTIFIER],
    });
    expect(runtimeService.getToolManifests).toHaveBeenCalledWith([]);
    expect(runtimeService.markActivated).not.toHaveBeenCalled();
  });

  it('activates lobe-local-system when a device is routed', async () => {
    const runtimeService = service({ hasActiveDevice: () => true });
    const runtime = new ActivatorExecutionRuntime({ service: runtimeService });

    const result = await runtime.activateTools({
      identifiers: [LOCAL_SYSTEM_IDENTIFIER],
      reason: 'open a shell',
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('{{hostname}}');
    expect(result.content).not.toContain(LOCAL_SYSTEM_NO_DEVICE_MESSAGE);
    expect(runtimeService.markActivated).toHaveBeenCalledWith([LOCAL_SYSTEM_IDENTIFIER]);
  });

  it('still activates lobe-local-system when the caller does not gate devices', async () => {
    const runtimeService = service();
    const runtime = new ActivatorExecutionRuntime({ service: runtimeService });

    const result = await runtime.activateTools({
      identifiers: [LOCAL_SYSTEM_IDENTIFIER],
      reason: 'desktop',
    });

    expect(result.content).toContain('Successfully activated tools:');
    expect(result.content).not.toContain(LOCAL_SYSTEM_NO_DEVICE_MESSAGE);
  });
});
