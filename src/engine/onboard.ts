import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { RepoInfo, RepoKey } from '../core/contract';
import type { JourneyConfig } from '../core/journey';
import type { Knowledge } from '../core/knowledge';
import { computeCoverage } from './coverage';
import { resolveNominal } from './coverage/nominal';
import { applyCatalog } from './knowledge/apply';
import { parseBpmn, type BpmnModel } from './parsers/bpmn';
import { loadFrontPackage, parseFront } from './parsers/front';
import { scanTests } from './parsers/scanTests';

/**
 * Onboarding d'un parcours (§13.3) : brouillon de config + rapport des points
 * à trancher. Rien n'est écrit dans les dépôts ; l'agent enquête ensuite et
 * propose, l'humain valide.
 */

const posix = (p: string) => p.split(sep).join('/');

function walk(dir: string, ext: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (f.endsWith(ext)) out.push(p);
  }
  return out;
}

/** Processus du dépôt workflow (id → fichier), configurés ou non. */
export function survey(repos: Record<RepoKey, RepoInfo>, configured: JourneyConfig[]): { process: string; file: string; configured: boolean }[] {
  const ids = new Set(configured.map((c) => c.id));
  const out: { process: string; file: string; configured: boolean }[] = [];
  for (const f of walk(repos.workflow.path, '.bpmn')) {
    try {
      const m = parseBpmn(readFileSync(f, 'utf8'));
      out.push({ process: m.processId, file: posix(relative(repos.workflow.path, f)), configured: ids.has(m.processId) });
    } catch {
      /* BPMN illisible : ignoré par le survey */
    }
  }
  return out.sort((a, b) => Number(a.configured) - Number(b.configured) || a.process.localeCompare(b.process));
}

export interface OnboardResult {
  config: JourneyConfig;
  draft: string;
  report: string;
  points: string[];
}

/** Brouillon de config pour un processus (configuré ou non) et rapport des points à trancher. */
export function onboard(processId: string, repos: Record<RepoKey, RepoInfo>, existing: JourneyConfig | undefined, knowledge: Knowledge): OnboardResult {
  const files = walk(repos.workflow.path, '.bpmn');
  let bpmn: BpmnModel | null = null;
  let bpmnFile = '';
  for (const f of files) {
    try {
      const m = parseBpmn(readFileSync(f, 'utf8'));
      if (m.processId === processId) {
        bpmn = m;
        bpmnFile = f;
        break;
      }
    } catch {
      /* suivant */
    }
  }
  if (!bpmn) throw new Error(`processus « ${processId} » introuvable dans ${repos.workflow.path}`);

  const frontDir = existing ? join(repos.front.path, existing.frontPackage) : join(repos.front.path, 'packages', processId);
  const front = parseFront(existsSync(frontDir) ? loadFrontPackage(frontDir) : {});
  const specs = existing?.specs ?? ['tests/ui', 'tests/workflow'].map((d) => `${d}/${processId}`).filter((p) => existsSync(join(repos.e2e.path, p)));

  const base: JourneyConfig = existing ?? {
    id: processId,
    label: bpmn.processName ?? processId,
    sessions: Object.fromEntries(front.groups.map((g) => [g, g])),
    bpmnDir: posix(relative(repos.workflow.path, dirname(bpmnFile))),
    frontPackage: posix(relative(repos.front.path, frontDir)),
    specs,
    locales: front.locales,
    excludedGroups: [],
    excludedStates: [],
    excludedBpmnSteps: [],
    excludedEmailTriggers: ['timer'],
    catalog: true,
  };
  const { config, outcome } = applyCatalog({ ...base, catalog: true }, knowledge.decisions, bpmn, front);
  const scan = existsSync(repos.e2e.path) && specs.length ? scanTests(repos.e2e.path, [...specs, ...(base.sharedSpecs ?? [])]) : { tests: [], files: [], readFiles: [], warnings: [] };
  const nominal = resolveNominal(config, front, scan, bpmn);
  const view = computeCoverage(config, 'ui', { bpmn, front, scan }, knowledge);

  const points: string[] = [];
  if (front.skeleton) points.push(`Package front introuvable ou squelette (${posix(relative(repos.front.path, frontDir))}) : rien à analyser côté écrans.`);
  if (!specs.length) points.push('Aucun dossier de specs trouvé pour ce processus : où sont ses tests ?');
  for (const s of bpmn.sessions.filter((x) => !x.sessionName && !config.bpmnSessions?.[x.id])) points.push(`Session ${s.id} : sessionName non évaluable (${s.sessionNameExpression ?? 'absent'}) → bpmnSessions ?`);
  for (const p of outcome.pending) points.push(`Branche ${p.target} : décision ${p.decision} ambiguë entre ${p.candidates.join(', ') || 'aucun candidat'}`);
  for (const b of view.bpmn.filter((x) => x.status === 'unlinked' && x.kind === 'branch' && !outcome.pending.some((p) => p.target === x.id))) points.push(`Branche ${b.id} (« ${b.label} ») : quelle preuve visible ?`);
  for (const a of view.ambiguous) points.push(`Classe ${a.marker} ambiguë entre ${a.candidates.join(', ')} → stepAliases ?`);
  for (const t of view.unknownLocaleTests) points.push(`Test « ${t.id} » (${t.file}:${t.line}) : langue illisible → defaultLocale ?`);
  if (!nominal.paths.length) points.push('Chemin nominal inconnu : le déclarer (nominalPaths).');
  else if (nominal.source !== 'config') points.push(`Chemin nominal ${nominal.source === 'p1' ? 'lu dans le test @P1' : 'proposé depuis le BPMN'} : à confirmer (${nominal.paths[0]!.screens.join(' → ')}).`);
  if (Object.values(config.sessions).some((l, i) => l === Object.keys(config.sessions)[i])) points.push('Libellés de sessions à écrire (ils reprennent les noms de groupes).');

  const draft = [
    "import type { JourneyConfig } from '../core/journey';",
    '',
    `/** Brouillon produit par \`pnpm onboard ${processId}\` : chaque choix de périmètre doit porter sa raison avant d'être appliqué. */`,
    `export const draft: JourneyConfig = ${JSON.stringify({ ...base, ...(nominal.source && nominal.source !== 'config' ? { nominalPaths: nominal.paths } : {}) }, null, 2)};`,
    '',
  ].join('\n');

  const report = [
    `# Onboarding — ${config.label} (${processId})`,
    '',
    `- BPMN : ${posix(relative(repos.workflow.path, bpmnFile))} (${bpmn.sessions.length} sessions, ${bpmn.emails.length} e-mails, ${bpmn.branches.length} branches)`,
    `- Front : ${front.skeleton ? 'aucun état' : `${front.groups.length} groupes, ${front.states.length} états, langues ${front.locales.join(', ')}`}`,
    `- Tests : ${scan.tests.length} (${specs.join(', ') || 'aucune spec'})`,
    `- Catalogue : ${outcome.applied.length} décision(s) appliquée(s), ${outcome.pending.length} à trancher`,
    '',
    '## Points à trancher',
    '',
    ...(points.length ? points.map((p) => `- ${p}`) : ['- Aucun.']),
    '',
    '## Propositions',
    '',
    '_À remplir par l’agent : tableau « Proposition | Preuve (fichier:ligne) | Confiance », puis « Questions ouvertes »._',
    '',
  ].join('\n');

  return { config, draft, report, points };
}
