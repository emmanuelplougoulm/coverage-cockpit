import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RepoInfo, RepoKey } from '../core/contract';

/**
 * Chemins des trois dépôts : convention du poste, surchargeable par variable
 * d'environnement (§3). Seule I/O : la lecture de l'environnement et l'existence.
 */
export const REPO_CONVENTIONS: Record<RepoKey, { envVar: string; defaultDir: string }> = {
  workflow: { envVar: 'CC_REPO_WORKFLOW', defaultDir: 'dev/repo-workflow' },
  front: { envVar: 'CC_REPO_FRONT', defaultDir: 'dev/repo-front' },
  e2e: { envVar: 'CC_REPO_E2E', defaultDir: 'dev/repo-e2e' },
};

export function resolveRepos(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  exists: (p: string) => boolean = existsSync,
): Record<RepoKey, RepoInfo> {
  const out = {} as Record<RepoKey, RepoInfo>;
  for (const key of Object.keys(REPO_CONVENTIONS) as RepoKey[]) {
    const { envVar, defaultDir } = REPO_CONVENTIONS[key];
    const fromEnv = env[envVar]?.trim();
    const path = fromEnv ? fromEnv : join(home, defaultDir);
    out[key] = { key, path, envVar, overridden: Boolean(fromEnv), exists: exists(path) };
  }
  return out;
}
