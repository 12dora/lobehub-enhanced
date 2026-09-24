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

describe('ServerToolTransport bot thread', () => {
  beforeEach(() => {
    executeTool.mockReset();
    executeTool.mockResolvedValue({ content: 'ok', success: true });
  });

  const contextOf = () =>
    executeTool.mock.calls.at(-1)?.[1] as {
      botPlatform?: string;
      botThreadId?: string;
    };

  it('forwards platformThreadId only when platform is a string', async () => {
    await run({
      botContext: { platform: 'dingtalk', platformThreadId: 'dingtalk:cid:staff_1' },
    });
    expect(contextOf()).toMatchObject({
      botPlatform: 'dingtalk',
      botThreadId: 'dingtalk:cid:staff_1',
    });

    await run({ botContext: { platform: 'dingtalk', platformThreadId: 'dingtalk:cid_dm' } });
    expect(contextOf()).toMatchObject({
      botPlatform: 'dingtalk',
      botThreadId: 'dingtalk:cid_dm',
    });

    await run({ botContext: { platform: '', platformThreadId: 'dingtalk:cid' } });
    expect(contextOf().botPlatform).toBe('');
    expect(contextOf().botThreadId).toBe('dingtalk:cid');

    await run({ botContext: { platformThreadId: 'dingtalk:cid' } });
    expect(contextOf().botPlatform).toBeUndefined();
    expect(contextOf().botThreadId).toBeUndefined();

    await run({ botContext: { platform: 'dingtalk', platformThreadId: 12 } });
    expect(contextOf().botPlatform).toBe('dingtalk');
    expect(contextOf().botThreadId).toBeUndefined();

    await run({ botContext: { platform: 1, platformThreadId: 'dingtalk:cid' } });
    expect(contextOf().botPlatform).toBeUndefined();
    expect(contextOf().botThreadId).toBeUndefined();

    await run({});
    expect(contextOf().botPlatform).toBeUndefined();
    expect(contextOf().botThreadId).toBeUndefined();
  });
});
