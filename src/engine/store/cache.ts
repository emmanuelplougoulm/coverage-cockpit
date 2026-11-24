import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoInfo, RepoKey } from '../../core/contract';
import { viewCells, type CoverageView, type Suite } from '../../core/coverage';
import { snapshotChanged, type CacheInfo, type CacheStatus, type LastViews, type Snapshot } from '../../core/history';
import type { JourneyConfig } from '../../core/journey';
import { appendJsonl, readJson, readJsonl, safeName, writeJsonAtomic } from './dataDir';
import { fingerprint, gitInfo, sha256 } from './fingerprint';
import { InputLog, inputsKey, inputsUnchanged, type InputRecord } from './inputs';

/**
 * Cache par empreinte (§10). Clé = hash(parcours, empreinte de chaque dépôt,
 * empreinte de l'outil restreinte à ses entrées utiles). Si la clé a changé,
 * une clé plus fine (fichiers réellement lus) peut encore éviter l'analyse.
 */

/** À incrémenter quand le format des vues change : invalide tous les caches. */
export const CACHE_VERSION = '5'; // 2 : capturedBy[].shot / image ; 3 : nominal, transitions, texts, testTags

export interface CacheEntry {
  version: string;
  key: string;
  /** Emplacement des dépôts : une autre copie = une autre analyse. */
  reposKey: string;
  toolKey: string;
  inputsKey: string;
  inputs: InputRecord;
  analyzedAt: string;
  views: Record<Suite, CoverageView>;
}

export interface AnalyzeDeps {
  repos: Record<RepoKey, RepoInfo>;
  dataDir: string;
  toolRoot: string;
  /** Fichier de config du parcours, relatif à l'outil. */
  journeyFile: string;
  force?: boolean;
  now?: () => Date;
  /** Analyse complète (chargée à la demande : module lourd). */
  compute: (log: InputLog) => Promise<Record<Suite, CoverageView>>;
}

/** Entrées utiles de l'outil : moteur, cœur, connaissance, dépendances, et SA config seulement. */
export function toolPaths(journeyFile: string): string[] {
  return ['src/core', 'src/engine', 'knowledge', 'package.json', 'pnpm-lock.yaml', journeyFile];
}

export const cachePath = (dir: string, id: string) => join(dir, 'cache', `${safeName(id)}.json`);
export const historyPath = (dir: string, id: string, suite: Suite) => join(dir, 'history', `${safeName(id)}.${suite}.jsonl`);
export const lastViewPath = (dir: string, id: string) => join(dir, 'last-views', `${safeName(id)}.json`);

export async function cachedCoverage(
  config: JourneyConfig,
  deps: AnalyzeDeps,
): Promise<{ views: Record<Suite, CoverageView>; cache: Record<Suite, CacheInfo> }> {
  const started = Date.now();
  const now = deps.now ?? (() => new Date());
  const { repos } = deps;
  const toolKey = fingerprint(deps.toolRoot, toolPaths(deps.journeyFile));
  const reposKey = sha256(repos.workflow.path, repos.front.path, repos.e2e.path);
  const key = sha256(
    CACHE_VERSION,
    config.id,
    toolKey,
    reposKey,
    fingerprint(repos.workflow.path, [config.bpmnDir]),
    fingerprint(repos.front.path, [config.frontPackage]),
    fingerprint(repos.e2e.path, null),
  );

  const path = cachePath(deps.dataDir, config.id);
  const entry = readJson<CacheEntry>(path);
  const usable = entry && entry.version === CACHE_VERSION ? entry : undefined;

  let status: CacheStatus;
  let views: Record<Suite, CoverageView>;
  let analyzedAt: string;
  if (!deps.force && usable?.key === key) {
    status = 'hit';
    views = usable.views;
    analyzedAt = usable.analyzedAt;
  } else if (!deps.force && usable && usable.toolKey === toolKey && usable.reposKey === reposKey && inputsUnchanged(usable.inputs)) {
    // Le dépôt a bougé, mais pas ce que l'analyse lit : même résultat.
    status = 'inputs';
    views = usable.views;
    analyzedAt = usable.analyzedAt;
    writeJsonAtomic(path, { ...usable, key });
  } else {
    status = deps.force ? 'forced' : 'miss';
    const log = new InputLog();
    views = await deps.compute(log);
    analyzedAt = now().toISOString();
    const inputs = log.record();
    writeJsonAtomic(path, { version: CACHE_VERSION, key, reposKey, toolKey, inputsKey: inputsKey(inputs, toolKey), inputs, analyzedAt, views } satisfies CacheEntry);
  }

  const appended: Record<Suite, boolean> = { ui: false, workflow: false };
  if (status === 'miss' || status === 'forced') {
    const sources = {
      tests: gitInfo(repos.e2e.path, null),
      front: gitInfo(repos.front.path, [config.frontPackage]),
      workflow: gitInfo(repos.workflow.path, [config.bpmnDir]),
    };
    for (const suite of ['ui', 'workflow'] as const) {
      const hp = historyPath(deps.dataDir, config.id, suite);
      const prev = readJsonl<Snapshot>(hp).at(-1);
      const next = { testsScanned: views[suite].testsScanned, cells: viewCells(views[suite]) };
      if (snapshotChanged(prev, next)) {
        appendJsonl(hp, { at: analyzedAt, journey: config.id, suite, sources, ...next } satisfies Snapshot);
        appended[suite] = true;
      }
    }
  }
  writeJsonAtomic(lastViewPath(deps.dataDir, config.id), { journey: config.id, at: analyzedAt, views } satisfies LastViews);

  const ms = Date.now() - started;
  const info = (suite: Suite): CacheInfo => ({ status, key, analyzedAt, ms, historyAppended: appended[suite] });
  return { views, cache: { ui: info('ui'), workflow: info('workflow') } };
}

/** Dernières vues enregistrées, sans rien recalculer (affichage immédiat au lancement). */
export function readLastViews(dataDir: string): LastViews[] {
  const dir = join(dataDir, 'last-views');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson<LastViews>(join(dir, f)))
    .filter((v): v is LastViews => !!v);
}

export function readHistory(dataDir: string, id: string, suite: Suite): Snapshot[] {
  return readJsonl<Snapshot>(historyPath(dataDir, id, suite));
}
