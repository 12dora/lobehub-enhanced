import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminSystemService } from './adminSystem';

const mocks = vi.hoisted(() => ({
  alertsGet: vi.fn(),
  alertsTest: vi.fn(),
  alertsUpdate: vi.fn(),
  cancelDocumentRenderJob: vi.fn(),
  cancelJob: vi.fn(),
  getDocumentRenderSettings: vi.fn(),
  getDocumentRenderStatus: vi.fn(),
  getInfraSettings: vi.fn(),
  getSandboxPackageStats: vi.fn(),
  getSandboxSettings: vi.fn(),
  getInstanceRevisions: vi.fn(),
  getStatus: vi.fn(),
  jobsClear: vi.fn(),
  jobsList: vi.fn(),
  retryDocumentRenderJob: vi.fn(),
  retryJob: vi.fn(),
  runDocumentRenderGc: vi.fn(),
  statusApiGet: vi.fn(),
  statusApiRevoke: vi.fn(),
  statusApiRotate: vi.fn(),
  testDependency: vi.fn(),
  updateDocumentRenderSettings: vi.fn(),
  updateSandboxSettings: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    admin: {
      system: {
        alerts: {
          get: { query: mocks.alertsGet },
          test: { mutate: mocks.alertsTest },
          update: { mutate: mocks.alertsUpdate },
        },
        cancelDocumentRenderJob: { mutate: mocks.cancelDocumentRenderJob },
        cancelJob: { mutate: mocks.cancelJob },
        getDocumentRenderSettings: { query: mocks.getDocumentRenderSettings },
        getDocumentRenderStatus: { query: mocks.getDocumentRenderStatus },
        getInfraSettings: { query: mocks.getInfraSettings },
        getSandboxPackageStats: { query: mocks.getSandboxPackageStats },
        getSandboxSettings: { query: mocks.getSandboxSettings },
        getInstanceRevisions: { query: mocks.getInstanceRevisions },
        getStatus: { query: mocks.getStatus },
        jobs: {
          clear: { mutate: mocks.jobsClear },
          list: { query: mocks.jobsList },
        },
        retryDocumentRenderJob: { mutate: mocks.retryDocumentRenderJob },
        retryJob: { mutate: mocks.retryJob },
        runDocumentRenderGc: { mutate: mocks.runDocumentRenderGc },
        statusApi: {
          get: { query: mocks.statusApiGet },
          revoke: { mutate: mocks.statusApiRevoke },
          rotate: { mutate: mocks.statusApiRotate },
        },
        testDependency: { mutate: mocks.testDependency },
        updateDocumentRenderSettings: { mutate: mocks.updateDocumentRenderSettings },
        updateSandboxSettings: { mutate: mocks.updateSandboxSettings },
      },
    },
  },
}));

describe('Admin System service adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards read inputs to admin.system procedures', async () => {
    const status = { snapshotAt: new Date('2026-07-20T00:00:00.000Z') };
    const instances = { items: [], nextCursor: null };
    const jobs = { clearedAt: null, items: [], page: 2, pageSize: 50, total: 0 };
    mocks.getStatus.mockResolvedValue(status);
    mocks.getInstanceRevisions.mockResolvedValue(instances);
    mocks.jobsList.mockResolvedValue(jobs);

    await expect(adminSystemService.getStatus()).resolves.toBe(status);
    await expect(adminSystemService.getInstanceRevisions({ limit: 20 })).resolves.toBe(instances);
    await expect(adminSystemService.listJobs({ page: 2, pageSize: 50 })).resolves.toBe(jobs);
    expect(mocks.getStatus).toHaveBeenCalledWith();
    expect(mocks.getInstanceRevisions).toHaveBeenCalledWith({ limit: 20 });
    expect(mocks.jobsList).toHaveBeenCalledWith({ page: 2, pageSize: 50 });
  });

  it('clears finished jobs through admin.system.jobs.clear with an empty input', async () => {
    const cleared = { clearedAt: '2026-09-25T00:00:00.000Z', hidden: 12 };
    mocks.jobsClear.mockResolvedValue(cleared);

    await expect(adminSystemService.clearJobs()).resolves.toBe(cleared);
    expect(mocks.jobsClear).toHaveBeenCalledWith({});
  });

  it('forwards the alert-settings get / update / test procedures', async () => {
    const view = { revision: 3, settings: { enabled: true } };
    const input = {
      expectedRevision: 3,
      robotSecret: { action: 'keep' as const },
      settings: { enabled: false },
    };
    const tested = { delivered: 2, error: null, ok: true };
    mocks.alertsGet.mockResolvedValue(view);
    mocks.alertsUpdate.mockResolvedValue(view);
    mocks.alertsTest.mockResolvedValue(tested);

    await expect(adminSystemService.getAlertSettings()).resolves.toBe(view);
    await expect(adminSystemService.updateAlertSettings(input as never)).resolves.toBe(view);
    await expect(adminSystemService.testAlertChannel({ channel: 'email' })).resolves.toBe(tested);
    expect(mocks.alertsGet).toHaveBeenCalledWith();
    expect(mocks.alertsUpdate).toHaveBeenCalledWith(input);
    expect(mocks.alertsTest).toHaveBeenCalledWith({ channel: 'email' });
  });

  it('forwards the status API token procedures', async () => {
    const view = { envTokenConfigured: false, tokenHint: null, tokenSet: false };
    const rotated = { token: `sk-status-${'a'.repeat(32)}`, view };
    mocks.statusApiGet.mockResolvedValue(view);
    mocks.statusApiRotate.mockResolvedValue(rotated);
    mocks.statusApiRevoke.mockResolvedValue(view);

    await expect(adminSystemService.getStatusApi()).resolves.toBe(view);
    await expect(adminSystemService.rotateStatusApiToken()).resolves.toBe(rotated);
    await expect(adminSystemService.revokeStatusApiToken()).resolves.toBe(view);
    expect(mocks.statusApiGet).toHaveBeenCalledWith();
    expect(mocks.statusApiRotate).toHaveBeenCalledWith({});
    expect(mocks.statusApiRevoke).toHaveBeenCalledWith({});
  });

  it('forwards audited CAS mutation inputs without rewriting them', async () => {
    const shared = {
      expectedRevision: 3,
      jobId: 'pjob_0000000000000001',
      reason: 'operator verification',
      requestId: '00000000-0000-4000-8000-000000000001',
    };
    const cancelled = { ...shared, status: 'cancelled' };
    const retried = { ...shared, status: 'pending' };
    mocks.cancelJob.mockResolvedValue(cancelled);
    mocks.retryJob.mockResolvedValue(retried);

    await expect(
      adminSystemService.cancelJob({ ...shared, expectedStatus: 'running' }),
    ).resolves.toBe(cancelled);
    await expect(
      adminSystemService.retryJob({ ...shared, expectedStatus: 'failed' }),
    ).resolves.toBe(retried);
    expect(mocks.cancelJob).toHaveBeenCalledWith({ ...shared, expectedStatus: 'running' });
    expect(mocks.retryJob).toHaveBeenCalledWith({ ...shared, expectedStatus: 'failed' });
  });

  it('forwards infrastructure overview and live-probe calls', async () => {
    const settings = { snapshotAt: new Date('2026-08-17T00:00:00.000Z') };
    const probe = { checkedAt: new Date('2026-08-17T00:00:01.000Z'), latencyMs: 12, ok: true };
    mocks.getInfraSettings.mockResolvedValue(settings);
    mocks.testDependency.mockResolvedValue(probe);

    await expect(adminSystemService.getInfraSettings()).resolves.toBe(settings);
    await expect(adminSystemService.testDependency({ dependency: 'mail' })).resolves.toBe(probe);
    expect(mocks.getInfraSettings).toHaveBeenCalledWith();
    expect(mocks.testDependency).toHaveBeenCalledWith({ dependency: 'mail' });
  });

  it('forwards sandbox settings get/update', async () => {
    const settings = { provider: 'local', revision: 1, source: 'db' };
    mocks.getSandboxSettings.mockResolvedValue(settings);
    mocks.updateSandboxSettings.mockResolvedValue(settings);

    await expect(adminSystemService.getSandboxSettings()).resolves.toBe(settings);
    await expect(
      adminSystemService.updateSandboxSettings({
        config: { enabled: true, provider: 'local' },
        expectedRevision: 0,
      }),
    ).resolves.toBe(settings);
    expect(mocks.getSandboxSettings).toHaveBeenCalledWith();
    expect(mocks.updateSandboxSettings).toHaveBeenCalledWith({
      config: { enabled: true, provider: 'local' },
      expectedRevision: 0,
    });
  });

  /** The ledger is a plain read: the window/limit go through untouched, and omitting them is legal. */
  it('forwards the sandbox package ledger query', async () => {
    const stats = {
      generatedAt: new Date('2026-08-23T00:00:00.000Z'),
      items: [],
      preinstalled: ['numpy'],
      totalPackages: 0,
      windowDays: 7,
    };
    mocks.getSandboxPackageStats.mockResolvedValue(stats);

    await expect(adminSystemService.getSandboxPackageStats({ days: 7, limit: 20 })).resolves.toBe(
      stats,
    );
    await expect(adminSystemService.getSandboxPackageStats()).resolves.toBe(stats);
    expect(mocks.getSandboxPackageStats).toHaveBeenNthCalledWith(1, { days: 7, limit: 20 });
    expect(mocks.getSandboxPackageStats).toHaveBeenNthCalledWith(2, {});
  });

  it('forwards document-render settings, status and queue actions', async () => {
    const settings = { config: { trigger: 'onUpload' }, revision: 2, source: 'db' };
    const status = { configured: true, moduleEnabled: true };
    mocks.getDocumentRenderSettings.mockResolvedValue(settings);
    mocks.updateDocumentRenderSettings.mockResolvedValue(settings);
    mocks.getDocumentRenderStatus.mockResolvedValue(status);
    mocks.retryDocumentRenderJob.mockResolvedValue({ ok: true });
    mocks.cancelDocumentRenderJob.mockResolvedValue({ ok: true });

    await expect(adminSystemService.getDocumentRenderSettings()).resolves.toBe(settings);
    await expect(adminSystemService.getDocumentRenderStatus()).resolves.toBe(status);
    await expect(
      adminSystemService.updateDocumentRenderSettings({
        config: { enabled: true, endpoint: 'http://document-render:3000' },
        expectedRevision: 1,
      }),
    ).resolves.toBe(settings);
    await expect(adminSystemService.retryDocumentRenderJob({ jobId: 'job-1' })).resolves.toEqual({
      ok: true,
    });
    await expect(adminSystemService.cancelDocumentRenderJob({ jobId: 'job-1' })).resolves.toEqual({
      ok: true,
    });
    mocks.runDocumentRenderGc.mockResolvedValue({ jobId: 'gc-1', ok: true });
    await expect(adminSystemService.runDocumentRenderGc({})).resolves.toEqual({
      jobId: 'gc-1',
      ok: true,
    });
    expect(mocks.runDocumentRenderGc).toHaveBeenCalledWith({});

    expect(mocks.updateDocumentRenderSettings).toHaveBeenCalledWith({
      config: { enabled: true, endpoint: 'http://document-render:3000' },
      expectedRevision: 1,
    });
    expect(mocks.retryDocumentRenderJob).toHaveBeenCalledWith({ jobId: 'job-1' });
    expect(mocks.cancelDocumentRenderJob).toHaveBeenCalledWith({ jobId: 'job-1' });
  });

  /** The probe rides the shared dependency mutation — a separate procedure would need its own registry entry. */
  it('probes the render sidecar through testDependency', async () => {
    const probe = { checkedAt: new Date('2026-08-22T00:00:00.000Z'), latencyMs: 4, ok: true };
    mocks.testDependency.mockResolvedValue(probe);

    await expect(adminSystemService.testDocumentRender()).resolves.toBe(probe);
    expect(mocks.testDependency).toHaveBeenCalledWith({ dependency: 'documentRender' });
  });
});
