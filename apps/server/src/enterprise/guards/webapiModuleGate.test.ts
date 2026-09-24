// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BOT_CALLBACK_BODY_LIMIT_BYTES,
  gateWebapiRequest,
  platformModuleDisabledBody,
  resolveWebapiModuleId,
  withWorkflowsModule,
} from './webapiModuleGate';

const mocks = vi.hoisted(() => ({
  isModuleEnabled: vi.fn(async (_id: string) => true),
}));

vi.mock('../services/moduleSettings', () => ({
  isModuleEnabled: (id: string) => mocks.isModuleEnabled(id),
}));

afterEach(() => {
  mocks.isModuleEnabled.mockReset();
  mocks.isModuleEnabled.mockResolvedValue(true);
});

describe('resolveWebapiModuleId', () => {
  it('maps agent gateway / messenger / webhooks to bots', () => {
    expect(resolveWebapiModuleId('/api/agent/gateway')).toBe('bots');
    expect(resolveWebapiModuleId('/api/agent/gateway/start')).toBeUndefined();
    expect(resolveWebapiModuleId('/api/agent/webhooks/discord/app-1')).toBe('bots');
    expect(resolveWebapiModuleId('/api/agent/webhooks/bot-callback')).toBeUndefined();
    expect(resolveWebapiModuleId('/api/agent/webhooks/subagent-callback')).toBeUndefined();
    expect(resolveWebapiModuleId('/api/agent/webhooks/group-member-callback')).toBeUndefined();
    expect(resolveWebapiModuleId('/api/agent/messenger/slack/install')).toBe('bots');
    expect(resolveWebapiModuleId('/gateway/start')).toBeUndefined();
  });

  it('maps workflows sub-mounts and leaves core agent paths unmapped', () => {
    expect(resolveWebapiModuleId('/api/workflows/agent-signal/nightly')).toBe('agentSignal');
    expect(resolveWebapiModuleId('/api/workflows/memory-user-memory/hourly')).toBe('memory');
    expect(resolveWebapiModuleId('/api/workflows/task/watchdog')).toBe('workflows');
    expect(resolveWebapiModuleId('/api/agent')).toBeUndefined();
    expect(resolveWebapiModuleId('/api/agent/run')).toBeUndefined();
  });
});

describe('gateWebapiRequest', () => {
  it('returns 403 PLATFORM_MODULE_DISABLED when the module is off', async () => {
    mocks.isModuleEnabled.mockResolvedValue(false);
    const response = await gateWebapiRequest(
      new Request('http://localhost/api/agent/gateway/callback', { method: 'POST' }),
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    await expect(response!.json()).resolves.toEqual(platformModuleDisabledBody('bots'));
    expect(mocks.isModuleEnabled).toHaveBeenCalledWith('bots');
  });

  it('lets /api/agent/gateway/start through so the handler can answer 200 disabled', async () => {
    mocks.isModuleEnabled.mockResolvedValue(false);
    expect(
      await gateWebapiRequest(
        new Request('http://localhost/api/agent/gateway/start', { method: 'POST' }),
      ),
    ).toBeNull();
  });

  it('returns null for unmapped or enabled paths', async () => {
    expect(await gateWebapiRequest(new Request('http://localhost/api/agent/run'))).toBeNull();
    mocks.isModuleEnabled.mockResolvedValue(true);
    expect(
      await gateWebapiRequest(new Request('http://localhost/api/workflows/task/watchdog')),
    ).toBeNull();
  });

  it('gates bot-callback by platform and leaves the body readable', async () => {
    const dingtalkBody = JSON.stringify({
      platformThreadId: 'dingtalk:cid',
      type: 'completion',
    });
    const dingtalkRequest = new Request('http://localhost/api/agent/webhooks/bot-callback', {
      body: dingtalkBody,
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    mocks.isModuleEnabled.mockImplementation(async (id) => id !== 'bots');
    expect(await gateWebapiRequest(dingtalkRequest)).toBeNull();
    expect(mocks.isModuleEnabled).toHaveBeenCalledWith('dingtalk');
    await expect(dingtalkRequest.json()).resolves.toMatchObject({
      platformThreadId: 'dingtalk:cid',
    });

    mocks.isModuleEnabled.mockImplementation(async (id) => id !== 'dingtalk');
    const denied = await gateWebapiRequest(
      new Request('http://localhost/api/agent/webhooks/bot-callback', {
        body: JSON.stringify({ messengerInstallationKey: 'dingtalk:singleton' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(denied?.status).toBe(403);
    await expect(denied!.json()).resolves.toEqual(platformModuleDisabledBody('dingtalk'));

    mocks.isModuleEnabled.mockImplementation(async (id) => id !== 'bots');
    const slack = await gateWebapiRequest(
      new Request('http://localhost/api/agent/webhooks/bot-callback', {
        body: JSON.stringify({ platformThreadId: 'slack:C1' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(slack?.status).toBe(403);
    await expect(slack!.json()).resolves.toEqual(platformModuleDisabledBody('bots'));
  });

  it('does not parse a bot-callback whose Content-Length is over 1 MB and falls back to bots', async () => {
    const payload = { platformThreadId: 'dingtalk:cid', type: 'completion' };
    const request = new Request('http://localhost/api/agent/webhooks/bot-callback', {
      body: JSON.stringify(payload),
      headers: {
        'content-length': String(BOT_CALLBACK_BODY_LIMIT_BYTES + 1),
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    mocks.isModuleEnabled.mockResolvedValue(true);
    expect(await gateWebapiRequest(request)).toBeNull();
    expect(mocks.isModuleEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.isModuleEnabled).toHaveBeenCalledWith('bots');
    await expect(request.json()).resolves.toEqual(payload);

    mocks.isModuleEnabled.mockImplementation(async (id) => id !== 'bots');
    const denied = await gateWebapiRequest(
      new Request('http://localhost/api/agent/webhooks/bot-callback', {
        body: JSON.stringify(payload),
        headers: {
          'content-length': String(BOT_CALLBACK_BODY_LIMIT_BYTES + 1),
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    );
    expect(denied?.status).toBe(403);
    await expect(denied!.json()).resolves.toEqual(platformModuleDisabledBody('bots'));
  });

  it('still classifies a bot-callback whose Content-Length is exactly 1 MB', async () => {
    const request = new Request('http://localhost/api/agent/webhooks/bot-callback', {
      body: JSON.stringify({ platformThreadId: 'dingtalk:cid' }),
      headers: {
        'content-length': String(BOT_CALLBACK_BODY_LIMIT_BYTES),
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    mocks.isModuleEnabled.mockImplementation(async (id) => id !== 'bots');
    expect(await gateWebapiRequest(request)).toBeNull();
    expect(mocks.isModuleEnabled).toHaveBeenCalledWith('dingtalk');
  });

  it('falls back to bots when a bot-callback has no Content-Length and exceeds 1 MB', async () => {
    const payload = JSON.stringify({
      padding: 'x'.repeat(BOT_CALLBACK_BODY_LIMIT_BYTES),
      platformThreadId: 'dingtalk:cid',
    });
    const bytes = new TextEncoder().encode(payload);
    expect(bytes.byteLength).toBeGreaterThan(BOT_CALLBACK_BODY_LIMIT_BYTES);
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 64 * 1024, bytes.byteLength);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
    });
    const request = new Request('http://localhost/api/agent/webhooks/bot-callback', {
      body,
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      // Node requires duplex when the body is a stream.
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();
    mocks.isModuleEnabled.mockResolvedValue(true);
    expect(await gateWebapiRequest(request)).toBeNull();
    expect(mocks.isModuleEnabled).toHaveBeenCalledWith('bots');
    expect(mocks.isModuleEnabled).not.toHaveBeenCalledWith('dingtalk');
  });

  it('classifies a small bot-callback that has no Content-Length and leaves the body readable', async () => {
    const payload = { platformThreadId: 'dingtalk:cid' };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const request = new Request('http://localhost/api/agent/webhooks/bot-callback', {
      body,
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();
    mocks.isModuleEnabled.mockImplementation(async (id) => id !== 'bots');
    expect(await gateWebapiRequest(request)).toBeNull();
    expect(mocks.isModuleEnabled).toHaveBeenCalledWith('dingtalk');
    await expect(request.json()).resolves.toEqual(payload);
  });

  it('does not require bots for subagent or group-member callbacks', async () => {
    mocks.isModuleEnabled.mockImplementation(async (id) => id !== 'bots');
    expect(
      await gateWebapiRequest(
        new Request('http://localhost/api/agent/webhooks/subagent-callback', { method: 'POST' }),
      ),
    ).toBeNull();
    expect(
      await gateWebapiRequest(
        new Request('http://localhost/api/agent/webhooks/group-member-callback', {
          method: 'POST',
        }),
      ),
    ).toBeNull();
    expect(mocks.isModuleEnabled).not.toHaveBeenCalled();
  });
});

describe('withWorkflowsModule', () => {
  it('403s concrete agent-eval-run routes when workflows is off', async () => {
    mocks.isModuleEnabled.mockImplementation(async (id) => id !== 'workflows');
    const inner = vi.fn(async () => new Response('ok'));
    const response = await withWorkflowsModule(inner)(
      new Request('http://localhost/api/workflows/agent-eval-run/finalize-run', {
        method: 'POST',
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(platformModuleDisabledBody('workflows'));
    expect(inner).not.toHaveBeenCalled();
  });

  it('maps agent-signal / memory-user-memory to their own modules', async () => {
    mocks.isModuleEnabled.mockImplementation(async (id) => id !== 'agentSignal');
    const inner = vi.fn(async () => new Response('ok'));
    const denied = await withWorkflowsModule(inner)(
      new Request('http://localhost/api/workflows/agent-signal/nightly', { method: 'POST' }),
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual(platformModuleDisabledBody('agentSignal'));

    mocks.isModuleEnabled.mockResolvedValue(true);
    const allowed = await withWorkflowsModule(inner)(
      new Request('http://localhost/api/workflows/memory-user-memory/hourly', { method: 'POST' }),
    );
    expect(allowed.status).toBe(200);
    expect(inner).toHaveBeenCalledOnce();
  });
});
