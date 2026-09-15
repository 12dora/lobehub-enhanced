import type { OwnDeploymentOrigins } from '@lobechat/utils';
import { buildOwnDeploymentOrigins, setOwnDeploymentOriginsBinding } from '@lobechat/utils';

import { appEnv } from '@/envs/app';
import { fileEnv } from '@/envs/file';
import { getInfraSnapshot } from '@/server/enterprise/services/infraSettings/snapshot';

/**
 * Origin/path allowlist for inlining attachments that Codex cannot fetch.
 * Uses the same effective object-storage snapshot as FileService / getFullFileUrl.
 */
export const resolveOwnDeploymentOrigins = async (): Promise<OwnDeploymentOrigins> => {
  const appUrl = appEnv.APP_URL;
  const internalAppUrl = appEnv.INTERNAL_APP_URL;

  try {
    const snapshot = await getInfraSnapshot();
    if (snapshot.objectStorage.kind === 'complete') {
      return buildOwnDeploymentOrigins({
        appUrl,
        bucket: snapshot.objectStorage.bucket,
        endpoint: snapshot.objectStorage.endpoint,
        forcePathStyle: snapshot.objectStorage.forcePathStyle,
        internalAppUrl,
        publicDomain: snapshot.objectStorage.publicDomain,
      });
    }
  } catch {
    // Fall through to env-backed storage when the snapshot is unavailable.
  }

  return buildOwnDeploymentOrigins({
    appUrl,
    bucket: fileEnv.S3_BUCKET,
    endpoint: fileEnv.S3_ENDPOINT,
    forcePathStyle: fileEnv.S3_ENABLE_PATH_STYLE,
    internalAppUrl,
    publicDomain: fileEnv.S3_PUBLIC_DOMAIN,
  });
};

/**
 * Install `{ get: resolveOwnDeploymentOrigins }` on
 * `Symbol.for('aihub.ownDeploymentOrigins')` so packages (e.g. imageUrlToBase64)
 * can fetch this deployment's own storage without importing server code.
 *
 * `resolveOwnDeploymentOrigins` is not locally memoised; `getInfraSnapshot`
 * already caches the effective storage snapshot.
 */
export const registerOwnDeploymentOriginsBinding = (): void => {
  setOwnDeploymentOriginsBinding({ get: resolveOwnDeploymentOrigins });
};
