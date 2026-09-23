// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { projectSandboxHealth } from './sandboxProbe';

const checkedAt = new Date('2026-08-21T00:00:00.000Z');

describe('projectSandboxHealth', () => {
  it('marks an unreachable daemon as unavailable', () => {
    expect(
      projectSandboxHealth(
        {
          activeContainers: 0,
          daemonReachable: false,
          imagePresent: false,
          lastError: 'connect ECONNREFUSED',
        },
        8,
        checkedAt,
      ),
    ).toMatchObject({
      daemonReachable: false,
      errorCategory: 'operation_unavailable',
      imagePresent: false,
      maxContainers: 8,
      status: 'unavailable',
    });
  });

  it('marks a missing image as unavailable and keeps the pull policy', () => {
    expect(
      projectSandboxHealth(
        {
          activeContainers: 0,
          daemonReachable: true,
          imagePresent: false,
          lastError: '沙箱镜像 aihub-sandbox:latest 不存在（拉取策略 never）',
        },
        8,
        checkedAt,
        { image: 'aihub-sandbox:latest', pullPolicy: 'never' },
      ),
    ).toMatchObject({
      daemonReachable: true,
      errorCategory: 'operation_unavailable',
      image: 'aihub-sandbox:latest',
      imagePresent: false,
      lastError: '沙箱镜像 aihub-sandbox:latest 不存在（拉取策略 never）',
      pullPolicy: 'never',
      status: 'unavailable',
    });
  });

  it('keeps the configured image when the probe throws into an unreachable tile', () => {
    expect(
      projectSandboxHealth(
        {
          activeContainers: 0,
          daemonReachable: false,
          imagePresent: false,
          lastError: 'unreachable',
        },
        4,
        checkedAt,
        { image: '  aihub-sandbox:latest  ', pullPolicy: 'if-missing' },
      ),
    ).toMatchObject({
      image: 'aihub-sandbox:latest',
      lastError: 'unreachable',
      pullPolicy: 'if-missing',
      status: 'unavailable',
    });
  });

  it('is healthy when the daemon and image are present', () => {
    expect(
      projectSandboxHealth(
        { activeContainers: 3, daemonReachable: true, imagePresent: true },
        8,
        checkedAt,
      ),
    ).toEqual({
      activeContainers: 3,
      daemonReachable: true,
      detail: 'Docker',
      errorCategory: null,
      imagePresent: true,
      lastCheckedAt: checkedAt,
      maxContainers: 8,
      status: 'healthy',
    });
  });
});
