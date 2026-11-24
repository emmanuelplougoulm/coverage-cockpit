import { join } from 'node:path';
import type { JourneySummary, JourneysResult, PathCheck, RepoInfo, RepoKey } from '../core/contract';
import type { JourneyConfig } from '../core/journey';
import { validateConfigs } from '../core/validateConfig';

/**
 * Sous-commande `journeys` : liste des parcours configurés, avec l'état de
 * leurs sources. Pure : l'existence des chemins est injectée.
 */
export function summarizeJourneys(
  configs: JourneyConfig[],
  repos: Record<RepoKey, RepoInfo>,
  exists: (absolutePath: string) => boolean,
  pilotId: string,
): JourneysResult {
  const issues = validateConfigs(configs);
  const check = (repo: RepoKey, rel: string): PathCheck => {
    const path = join(repos[repo].path, rel);
    return { path, exists: repos[repo].exists && exists(path) };
  };

  const journeys = configs.map((c): JourneySummary => {
    const own = issues.filter((i) => i.journey === c.id).map(({ field, message }) => ({ field, message }));
    const bpmnDir = check('workflow', c.bpmnDir);
    const frontPackage = check('front', c.frontPackage);
    const specs = c.specs.map((s) => check('e2e', s));
    const allFound = bpmnDir.exists && frontPackage.exists && specs.every((s) => s.exists);
    return {
      id: c.id,
      label: c.label,
      pilot: c.id === pilotId,
      status: own.length > 0 ? 'invalid' : allFound ? 'ready' : 'incomplete',
      sessions: Object.values(c.sessions),
      locales: c.locales,
      nominalPaths: c.nominalPaths?.length ?? 0,
      bpmnDir,
      frontPackage,
      specs,
      issues: own,
    };
  });

  return { repos: Object.values(repos), journeys };
}
