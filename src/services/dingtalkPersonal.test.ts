import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { dingtalkPersonalService } from './dingtalkPersonal';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    dingtalkPersonal: {
      callTool: { mutate: vi.fn() },
      cancelLogin: { mutate: vi.fn() },
      checkStatus: { mutate: vi.fn() },
      getLoginJob: { query: vi.fn() },
      getStatus: { query: vi.fn() },
      preview: { query: vi.fn() },
      revoke: { mutate: vi.fn() },
      startLogin: { mutate: vi.fn() },
    },
  },
}));

const client = (lambdaClient as any).dingtalkPersonal;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dingtalkPersonalService', () => {
  it('reads and re-checks the authorization status', async () => {
    client.getStatus.query.mockResolvedValueOnce({ state: 'disabled' });
    client.checkStatus.mutate.mockResolvedValueOnce({ state: 'expired' });

    await expect(dingtalkPersonalService.getStatus()).resolves.toEqual({ state: 'disabled' });
    await expect(dingtalkPersonalService.checkStatus()).resolves.toEqual({ state: 'expired' });
    expect(client.getStatus.query).toHaveBeenCalledWith();
    expect(client.checkStatus.mutate).toHaveBeenCalledWith();
  });

  it('starts, polls and cancels a login job by id', async () => {
    const job = {
      expiresAt: '2026-09-24T08:15:00.000Z',
      jobId: 'job_1',
      status: 'pending',
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://login.dingtalk.com/oauth2/device/verify.htm?user_code=ABCD-EFGH',
    };
    client.startLogin.mutate.mockResolvedValueOnce(job);
    client.getLoginJob.query.mockResolvedValueOnce({ ...job, status: 'succeeded' });
    client.cancelLogin.mutate.mockResolvedValueOnce({ ok: true });

    await expect(dingtalkPersonalService.startLogin()).resolves.toEqual(job);
    await dingtalkPersonalService.getLoginJob({ jobId: 'job_1' });
    await dingtalkPersonalService.cancelLogin({ jobId: 'job_1' });

    expect(client.startLogin.mutate).toHaveBeenCalledWith();
    expect(client.getLoginJob.query).toHaveBeenCalledWith({ jobId: 'job_1' });
    expect(client.cancelLogin.mutate).toHaveBeenCalledWith({ jobId: 'job_1' });
  });

  it('revokes without input', async () => {
    client.revoke.mutate.mockResolvedValueOnce({ ok: true });
    await expect(dingtalkPersonalService.revoke()).resolves.toEqual({ ok: true });
    expect(client.revoke.mutate).toHaveBeenCalledWith();
  });

  it('forwards tool calls and write previews as-is', async () => {
    const output = { content: '{}', state: { kind: 'todos' }, success: true };
    client.callTool.mutate.mockResolvedValueOnce(output);
    client.preview.query.mockResolvedValueOnce({
      danger: false,
      lines: ['完成待办：周报'],
      title: '完成待办',
      warnings: [],
    });

    await expect(
      dingtalkPersonalService.callTool({ apiName: 'listMyTodos', args: {} } as any),
    ).resolves.toBe(output);
    await dingtalkPersonalService.preview({
      apiName: 'completeTodo',
      args: { taskId: 't1' },
    } as any);

    expect(client.callTool.mutate).toHaveBeenCalledWith({ apiName: 'listMyTodos', args: {} });
    expect(client.preview.query).toHaveBeenCalledWith({
      apiName: 'completeTodo',
      args: { taskId: 't1' },
    });
  });
});
