import { DEFAULT_SANDBOX_IMAGE, SANDBOX_LABEL, SANDBOX_LABEL_VALUE } from './constants';
import { DockerEngineClient, isDockerNotFound, wrapDockerUnreachable } from './dockerEngineClient';

/** Bound for the status-page ping and image inspect. Exec streams stay unbounded here. */
export const SANDBOX_HEALTH_PROBE_TIMEOUT_MS = 8000;

export const sandboxImageMissingMessage = (image: string, pullPolicy: string): string =>
  `沙箱镜像 ${image} 不存在（拉取策略 ${pullPolicy}）`;

export interface LocalSandboxHealth {
  activeContainers: number;
  daemonReachable: boolean;
  imagePresent: boolean;
  lastError?: string;
}

export type LocalSandboxHealthOptions = {
  host?: string;
  image?: string;
  pullPolicy?: 'always' | 'if-missing' | 'never';
  socketPath?: string;
};

export const checkLocalSandboxHealth = async (
  options: LocalSandboxHealthOptions = {},
): Promise<LocalSandboxHealth> => {
  const client = new DockerEngineClient({ host: options.host, socketPath: options.socketPath });
  const image = options.image || DEFAULT_SANDBOX_IMAGE;
  const pullPolicy = options.pullPolicy ?? 'if-missing';

  try {
    await client.ping(SANDBOX_HEALTH_PROBE_TIMEOUT_MS);
  } catch (error) {
    return {
      activeContainers: 0,
      daemonReachable: false,
      imagePresent: false,
      lastError: wrapDockerUnreachable(error).message,
    };
  }

  let imagePresent = false;
  let lastError: string | undefined;

  try {
    await client.imageInspect(image, SANDBOX_HEALTH_PROBE_TIMEOUT_MS);
    imagePresent = true;
  } catch (error) {
    if (isDockerNotFound(error)) {
      lastError = sandboxImageMissingMessage(image, pullPolicy);
    } else {
      lastError = (error as Error).message;
    }
  }

  let activeContainers = 0;
  try {
    const containers = await client.containerList({
      all: false,
      filters: { label: [`${SANDBOX_LABEL}=${SANDBOX_LABEL_VALUE}`] },
    });
    activeContainers = containers.length;
  } catch (error) {
    lastError = (error as Error).message;
  }

  return {
    activeContainers,
    daemonReachable: true,
    imagePresent,
    ...(lastError ? { lastError } : {}),
  };
};
