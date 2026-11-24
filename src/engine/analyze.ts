import { join } from 'node:path';
import type { RepoInfo, RepoKey } from '../core/contract';
import type { CoverageView, Suite } from '../core/coverage';
import type { JourneyConfig } from '../core/journey';
import type { Knowledge } from '../core/knowledge';
import { computeCoverage } from './coverage';
import { attachImages } from './images';
import { readBpmn, readFront, readTests } from './sources';
import type { InputLog } from './store/inputs';

/**
 * Analyse complète d'un parcours : lit les trois sources une fois, calcule les
 * deux suites. Module lourd (ts-morph, xmldom) : le moteur ne le charge que
 * quand le cache ne suffit pas.
 */
export function analyzeJourney(config: JourneyConfig, repos: Record<RepoKey, RepoInfo>, log?: InputLog, knowledge?: Knowledge): Record<Suite, CoverageView> {
  const sources = { bpmn: readBpmn(config, repos, log), front: readFront(config, repos, log), scan: readTests(config, repos, log) };
  const e2e = repos.e2e.path;
  // Images de référence : un ajout ou un retrait doit invalider la vue.
  for (const f of sources.scan.files) log?.dir(join(e2e, `${f}-snapshots`));
  return {
    ui: attachImages(computeCoverage(config, 'ui', sources, knowledge), e2e),
    workflow: attachImages(computeCoverage(config, 'workflow', sources, knowledge), e2e),
  };
}
