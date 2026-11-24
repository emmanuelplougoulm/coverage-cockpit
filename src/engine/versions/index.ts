import { join } from 'node:path';
import type { RepoInfo, RepoKey } from '../../core/contract';
import type { CoverageView, Suite } from '../../core/coverage';
import type { JourneyConfig } from '../../core/journey';
import type { ImpactsResult, VersionsResult } from '../../core/versions';
import { parseBpmn, type BpmnModel } from '../parsers/bpmn';
import { readJson, writeJsonAtomic } from '../store/dataDir';
import { diffBpmn } from './diff';
import { bpmnAt, compareVersions, fetchAndUpdate, versionsOf } from './history';
import { impactsOf } from './impacts';

/** Sous-commandes de versions (§11, §12) : bord I/O autour de fonctions pures. */

const seenPath = (dir: string) => join(dir, 'versions-seen.json');
export const readSeen = (dir: string): Record<string, string> => readJson<Record<string, string>>(seenPath(dir)) ?? {};

export function markSeen(dir: string, journey: string, version: string): Record<string, string> {
  const m = readSeen(dir);
  m[journey] = version;
  writeJsonAtomic(seenPath(dir), m);
  return m;
}

export function allVersions(journeys: JourneyConfig[], repos: Record<RepoKey, RepoInfo>, dataDir: string, fetch: boolean): VersionsResult {
  const root = repos.workflow.path;
  const f = fetch ? fetchAndUpdate(root) : { attempted: false, ok: true, updated: false };
  const seen = readSeen(dataDir);
  return { fetch: f, journeys: journeys.map((j) => versionsOf(j.id, root, j.bpmnDir, seen[j.id] ?? null)) };
}

/** Modèle BPMN du parcours à une version (`local` = copie de travail). */
export function modelAt(config: JourneyConfig, repos: Record<RepoKey, RepoInfo>, at: string): { model: BpmnModel; xml: string } {
  const v = versionsOf(config.id, repos.workflow.path, config.bpmnDir, null);
  const { files } = bpmnAt(repos.workflow.path, config.bpmnDir, at, v.versions);
  for (const xml of files) {
    const model = parseBpmn(xml);
    if (model.processId === config.id) return { model, xml };
  }
  throw new Error(`aucun processus « ${config.id} » à « ${at} »`);
}

/** Bornes par défaut : de la version vue (sinon la précédente) à la dernière publiée. */
export function defaultRange(config: JourneyConfig, repos: Record<RepoKey, RepoInfo>, dataDir: string): { from: string; to: string } {
  const v = versionsOf(config.id, repos.workflow.path, config.bpmnDir, readSeen(dataDir)[config.id] ?? null);
  const list = v.versions.map((x) => x.version);
  const to = list.at(-1) ?? 'local';
  const seen = v.seen && list.includes(v.seen) && compareVersions(v.seen, to) < 0 ? v.seen : null;
  const from = seen ?? list.at(-2) ?? to;
  return { from, to };
}

export function impactsBetween(
  config: JourneyConfig,
  repos: Record<RepoKey, RepoInfo>,
  views: Record<Suite, CoverageView>,
  from: string,
  to: string,
): ImpactsResult {
  const a = modelAt(config, repos, from).model;
  const b = modelAt(config, repos, to).model;
  return impactsOf(config.id, from, to, diffBpmn(a, b), a, b, config, views);
}
