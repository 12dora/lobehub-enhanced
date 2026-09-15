import { afterEach, describe, expect, it } from 'vitest';

import {
  getOwnDeploymentOriginsBinding,
  OWN_DEPLOYMENT_ORIGINS_BINDING,
  resolveBoundOwnDeploymentOrigins,
  setOwnDeploymentOriginsBinding,
} from './ownDeploymentOriginsBinding';
import { buildOwnDeploymentOrigins } from './url';

describe('ownDeploymentOriginsBinding', () => {
  const origins = buildOwnDeploymentOrigins({
    appUrl: 'https://app.example.com',
    bucket: 'bucket',
    endpoint: 'http://localhost:9000',
    forcePathStyle: true,
  });

  afterEach(() => {
    setOwnDeploymentOriginsBinding(undefined);
  });

  it('uses Symbol.for so server and packages share the same key', () => {
    expect(OWN_DEPLOYMENT_ORIGINS_BINDING).toBe(Symbol.for('aihub.ownDeploymentOrigins'));
  });

  it('returns undefined when the binding is missing', async () => {
    expect(getOwnDeploymentOriginsBinding()).toBeUndefined();
    await expect(resolveBoundOwnDeploymentOrigins()).resolves.toBeUndefined();
  });

  it('resolves a sync getter', async () => {
    setOwnDeploymentOriginsBinding({ get: () => origins });
    await expect(resolveBoundOwnDeploymentOrigins()).resolves.toBe(origins);
  });

  it('resolves an async getter', async () => {
    setOwnDeploymentOriginsBinding({ get: async () => origins });
    await expect(resolveBoundOwnDeploymentOrigins()).resolves.toBe(origins);
  });
});
