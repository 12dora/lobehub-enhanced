import { afterEach, describe, expect, it } from 'vitest';

import { FakeDockerEngine } from './__tests__/fakeDockerEngine';
import { checkLocalSandboxHealth } from './health';
import { LocalSandboxProvider } from './localSandboxProvider';
import { resetLocalSandboxSupervisors } from './supervisor';

describe('checkLocalSandboxHealth', () => {
  const engines: FakeDockerEngine[] = [];

  afterEach(async () => {
    await resetLocalSandboxSupervisors();
    await Promise.all(engines.splice(0).map(async (engine) => engine.close()));
  });

  it('reports daemon reachability, image presence, and active containers', async () => {
    const fake = new FakeDockerEngine();
    fake.addImage('aihub-sandbox:latest');
    await fake.listen();
    engines.push(fake);

    const cold = await checkLocalSandboxHealth({ socketPath: fake.socketPath });
    expect(cold).toEqual({
      activeContainers: 0,
      daemonReachable: true,
      imagePresent: true,
    });

    const provider = new LocalSandboxProvider({
      idleTtlSec: 1800,
      image: 'aihub-sandbox:latest',
      maxContainers: 8,
      maxOutputBytes: 1024,
      memoryBytes: 1024,
      nanoCpus: 1e9,
      network: 'bridge',
      pidsLimit: 256,
      pullOnDemand: true,
      pullPolicy: 'if-missing',
      socketPath: fake.socketPath,
      timeoutMs: 2000,
      topicId: 'topic-1',
      userId: 'user-1',
    });
    await provider.callTool('runCommand', { command: 'echo ok' });

    const hot = await checkLocalSandboxHealth({ socketPath: fake.socketPath });
    expect(hot).toMatchObject({
      activeContainers: 1,
      daemonReachable: true,
      imagePresent: true,
    });
  });

  it('reports a missing image with the pull policy instead of dropping the error', async () => {
    const fake = new FakeDockerEngine();
    await fake.listen();
    engines.push(fake);

    const result = await checkLocalSandboxHealth({
      image: 'aihub-sandbox:latest',
      pullPolicy: 'never',
      socketPath: fake.socketPath,
    });
    expect(result).toMatchObject({
      daemonReachable: true,
      imagePresent: false,
      lastError: '沙箱镜像 aihub-sandbox:latest 不存在（拉取策略 never）',
    });
  });

  it('returns lastError when the daemon is unreachable', async () => {
    const result = await checkLocalSandboxHealth({
      socketPath: '/tmp/aihub-no-such-docker.sock',
    });
    expect(result.daemonReachable).toBe(false);
    expect(result.imagePresent).toBe(false);
    expect(result.lastError).toMatch(/Docker daemon is unreachable/);
  });
});
