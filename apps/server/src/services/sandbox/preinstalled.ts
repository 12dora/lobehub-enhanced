/**
 * Pip packages baked into `Dockerfile.sandbox`. Alias of the shared LOCAL image
 * list; keep the Dockerfile pip block identical (lowercase, pip-normalized).
 * The sibling test parses the Dockerfile so the two cannot drift.
 */
export type { SandboxLocalPipPackage as SandboxPreinstalledPipPackage } from '@lobechat/builtin-tool-cloud-sandbox';
export { SANDBOX_LOCAL_PIP_PACKAGES as SANDBOX_PREINSTALLED_PIP_PACKAGES } from '@lobechat/builtin-tool-cloud-sandbox';
