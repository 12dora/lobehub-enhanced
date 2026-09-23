import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerToolTransport } from './ServerToolTransport';

const executeTool = vi.fn();

const transport = () =>
  new ServerToolTransport({
    operationId: 'op-1',
    serverDB: {} as never,
    stepIndex: 0,
    streamManager: {},
    toolExecutionService: { executeTool },
    topicId: 'topic-1',
    userId: 'user-1',
  } as never);

const run = (metadata: Record<string, unknown>) =>
  transport().run(
    {
      apiName: 'runCommand',
      id: 'call-1',
      identifier: 'lobe-skills',
      type: 'builtin',
    } as never,
    {
      callIndex: 0,
      effectiveManifestMap: {},
      mode: 'batch',
      operationId: 'op-1',
      parentMessageId: 'msg-1',
      parsedArgs: {},
      state: { metadata },
      stepIndex: 0,
      toolName: 'lobe-skills____runCommand',
    } as never,
  );

describe('ServerToolTransport device skill gate', () => {
  beforeEach(() => {
    executeTool.mockReset();
    executeTool.mockResolvedValue({ content: 'ok', success: true });
  });

  it('keeps deviceCapable broad and deviceOnlySkillsAvailable narrow', async () => {
    await run({
      executionPlan: { kind: 'device-unrouted', reason: 'no-bound-device', target: 'auto' },
      onlineDeviceCount: 0,
    });

    expect(executeTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deviceCapable: true,
        deviceOnlySkillsAvailable: false,
      }),
    );

    executeTool.mockClear();
    await run({
      executionPlan: {
        kind: 'device-unrouted',
        reason: 'ambiguous-online-devices',
        target: 'auto',
      },
      onlineDeviceCount: 2,
    });

    expect(executeTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deviceCapable: true,
        deviceOnlySkillsAvailable: true,
      }),
    );
  });

  it('trusts a no-bound-device plan when the online count was not recorded', async () => {
    await run({
      executionPlan: { kind: 'device-unrouted', reason: 'no-bound-device', target: 'local' },
    });

    expect(executeTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deviceOnlySkillsAvailable: true,
      }),
    );
  });

  it('leaves both flags unset when the operation has no execution plan', async () => {
    await run({});

    expect(executeTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deviceCapable: undefined,
        deviceOnlySkillsAvailable: undefined,
      }),
    );
  });
});
