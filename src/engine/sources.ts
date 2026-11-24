import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoInfo, RepoKey } from '../core/contract';
import type { JourneyConfig } from '../core/journey';
import { parseBpmn, type BpmnModel } from './parsers/bpmn';
import { loadFrontPackage, parseFront, type FrontModel } from './parsers/front';
import { scanTests, type ScanResult } from './parsers/scanTests';
import type { InputLog } from './store/inputs';

/** Lecture des trois sources d'un parcours (I/O en bordure, parseurs purs). */

export class SourceError extends Error {}

function bpmnFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new SourceError(`dossier BPMN introuvable : ${dir}`);
  return readdirSync(dir).filter((f) => f.endsWith('.bpmn')).sort().map((f) => join(dir, f));
}

/** Modèle BPMN du parcours : le fichier dont le processus porte l'identifiant du parcours. */
export function readBpmn(config: JourneyConfig, repos: Record<RepoKey, RepoInfo>, log?: InputLog): BpmnModel {
  const dir = join(repos.workflow.path, config.bpmnDir);
  log?.dir(dir);
  const files = bpmnFiles(dir);
  files.forEach((f) => log?.file(f));
  const models = files.map((f) => parseBpmn(readFileSync(f, 'utf8')));
  const model = models.find((m) => m.processId === config.id);
  if (!model) {
    throw new SourceError(`aucun processus « ${config.id} » dans ${config.bpmnDir} (trouvés : ${models.map((m) => m.processId).join(', ') || 'aucun'})`);
  }
  return model;
}

export function readFront(config: JourneyConfig, repos: Record<RepoKey, RepoInfo>, log?: InputLog): FrontModel {
  const root = join(repos.front.path, config.frontPackage);
  log?.dir(root);
  const files = loadFrontPackage(root);
  for (const rel of Object.keys(files)) if (!rel.startsWith('emails/')) log?.file(join(root, rel));
  return parseFront(files);
}

export function readTests(config: JourneyConfig, repos: Record<RepoKey, RepoInfo>, log?: InputLog): ScanResult {
  if (!repos.e2e.exists) throw new SourceError(`dépôt de tests introuvable : ${repos.e2e.path}`);
  const specs = [...config.specs, ...(config.sharedSpecs ?? [])];
  const result = scanTests(repos.e2e.path, specs);
  for (const s of specs) log?.dir(join(repos.e2e.path, s));
  result.readFiles.forEach((f) => log?.file(f));
  return result;
}
