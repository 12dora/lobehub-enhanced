import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SANDBOX_LOCAL_APT_PACKAGES,
  SANDBOX_LOCAL_NPM_PACKAGES,
  SANDBOX_LOCAL_PIP_PACKAGES,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { describe, expect, it } from 'vitest';

import { SANDBOX_PREINSTALLED_PIP_PACKAGES } from './preinstalled';

const dockerfilePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../Dockerfile.sandbox',
);

const parseDockerfilePipPackages = (source: string): string[] => {
  const packages: string[] = [];
  let inBlock = false;
  for (const line of source.split('\n')) {
    if (!inBlock) {
      if (line.includes('--upgrade')) continue;
      if (/pip install --no-cache-dir\s*(?:\\\s*)?$/.test(line.trimEnd())) {
        inBlock = true;
      }
      continue;
    }
    const match = line.match(/^\s+([A-Z0-9][\w.-]*)\s*(?:\\\s*)?$/i);
    if (!match?.[1]) {
      inBlock = false;
      continue;
    }
    packages.push(match[1].toLowerCase().replaceAll('_', '-'));
    if (!line.trimEnd().endsWith('\\')) inBlock = false;
  }
  return packages;
};

/** xz-utils is installed only to unpack Node and purged in the same layer. */
const parseDockerfileAptPackages = (source: string): string[] => {
  const packages: string[] = [];
  let inBlock = false;
  for (const line of source.split('\n')) {
    if (!inBlock) {
      if (/apt-get install -y --no-install-recommends\s*(?:\\\s*)?$/.test(line.trimEnd())) {
        inBlock = true;
      }
      continue;
    }
    const match = line.match(/^\s+([a-z0-9][+a-z0-9.-]*)\s*(?:\\\s*)?$/i);
    if (!match?.[1]) {
      inBlock = false;
      continue;
    }
    const name = match[1];
    if (name !== 'xz-utils') packages.push(name);
    if (!line.trimEnd().endsWith('\\')) inBlock = false;
  }
  return packages;
};

const parseDockerfileNpmPackages = (source: string): string[] => {
  const packages: string[] = [];
  let inBlock = false;
  for (const line of source.split('\n')) {
    if (!inBlock) {
      if (/npm install -g\s*(?:\\\s*)?$/.test(line.trimEnd())) {
        inBlock = true;
      }
      continue;
    }
    const match = line.match(/^\s+"?(@?[\w.-]+(?:\/[\w.-]+)?)(?:@[^"\\\s]+)?"?\s*(?:\\\s*)?$/);
    if (!match?.[1]) {
      inBlock = false;
      continue;
    }
    packages.push(match[1]);
    if (!line.trimEnd().endsWith('\\')) inBlock = false;
  }
  return packages;
};

describe('SANDBOX_PREINSTALLED_PIP_PACKAGES', () => {
  it('is the SANDBOX_LOCAL_PIP_PACKAGES alias', () => {
    expect(SANDBOX_PREINSTALLED_PIP_PACKAGES).toBe(SANDBOX_LOCAL_PIP_PACKAGES);
  });

  it('matches Dockerfile.sandbox pip install block (lowercase, pip-normalized, alphabetical)', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    const fromDockerfile = parseDockerfilePipPackages(dockerfile);
    expect(fromDockerfile).toEqual([...SANDBOX_PREINSTALLED_PIP_PACKAGES]);
    expect(fromDockerfile).toEqual([...fromDockerfile].sort((a, b) => a.localeCompare(b)));
  });
});

describe('Dockerfile.sandbox package blocks', () => {
  it('apt install block matches SANDBOX_LOCAL_APT_PACKAGES (minus purged xz-utils)', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    const fromDockerfile = parseDockerfileAptPackages(dockerfile);
    expect(fromDockerfile).toEqual([...SANDBOX_LOCAL_APT_PACKAGES]);
    expect(fromDockerfile).toEqual([...fromDockerfile].sort((a, b) => a.localeCompare(b)));
  });

  it('npm -g block matches SANDBOX_LOCAL_NPM_PACKAGES (names without version suffix)', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf8');
    const fromDockerfile = parseDockerfileNpmPackages(dockerfile);
    expect(fromDockerfile).toEqual([...SANDBOX_LOCAL_NPM_PACKAGES]);
    expect(fromDockerfile).toEqual([...fromDockerfile].sort((a, b) => a.localeCompare(b)));
  });
});
