import type { OwnDeploymentOrigins } from './url';

/**
 * Process-wide seam for this deployment's storage origins.
 *
 * `packages/utils` must not import server code. The server registers
 * `{ get: resolveOwnDeploymentOrigins }` on `globalThis` via
 * `Symbol.for('aihub.ownDeploymentOrigins')`, mirroring
 * `aihub.networkProxy.egressBinding`.
 */
export const OWN_DEPLOYMENT_ORIGINS_BINDING = Symbol.for('aihub.ownDeploymentOrigins');

export interface OwnDeploymentOriginsBinding {
  get: () => OwnDeploymentOrigins | Promise<OwnDeploymentOrigins>;
}

type GlobalWithOwnDeploymentOrigins = typeof globalThis & {
  [OWN_DEPLOYMENT_ORIGINS_BINDING]?: OwnDeploymentOriginsBinding;
};

export const getOwnDeploymentOriginsBinding = (): OwnDeploymentOriginsBinding | undefined =>
  (globalThis as GlobalWithOwnDeploymentOrigins)[OWN_DEPLOYMENT_ORIGINS_BINDING];

export const setOwnDeploymentOriginsBinding = (
  binding: OwnDeploymentOriginsBinding | undefined,
): void => {
  const globalWithBinding = globalThis as GlobalWithOwnDeploymentOrigins;
  if (binding) {
    globalWithBinding[OWN_DEPLOYMENT_ORIGINS_BINDING] = binding;
    return;
  }
  delete globalWithBinding[OWN_DEPLOYMENT_ORIGINS_BINDING];
};

/**
 * Read the process-wide origins binding. Missing / incomplete binding →
 * `undefined` (callers keep today's fetch behaviour).
 */
export const resolveBoundOwnDeploymentOrigins = async (): Promise<
  OwnDeploymentOrigins | undefined
> => {
  const binding = getOwnDeploymentOriginsBinding();
  if (typeof binding?.get !== 'function') return undefined;
  return binding.get();
};
