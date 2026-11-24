import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoInfo, RepoKey } from '../core/contract';
import type { CoverageView } from '../core/coverage';
import type { JourneyConfig } from '../core/journey';
import { ownGitRoot } from './agents/branch';
import { stepCandidates } from './coverage/resolve';
import type { FrontModel } from './parsers/front';
import type { ScanResult } from './parsers/scanTests';
import { git } from './store/fingerprint';

/**
 * Gains rapides sans IA (§6) : pour un test qui traverse déjà un écran sans le
 * capturer, ajouter `await <page>.validateUI();` avant sa première action.
 * Aperçu en hunks ; application = commit local sur une nouvelle branche.
 */

export interface Insertion {
  file: string;
  /** Ligne (1-based) AVANT laquelle insérer. */
  line: number;
  text: string;
  variable: string;
  className: string;
  states: string[];
  tests: string[];
}

export interface Unplaced {
  test: string;
  state: string;
  reason: string;
}

export interface HunkLine {
  kind: 'context' | 'added' | 'removed';
  text: string;
  /** Numéro de ligne dans le fichier modifié. */
  line: number;
}

export interface Hunk {
  file: string;
  lines: HunkLine[];
}

export interface CapturesPlan {
  journey: string;
  insertions: Insertion[];
  unplaced: Unplaced[];
  hunks: Hunk[];
  warnings: string[];
  /** Commande qui lance les tests touchés et écrit les premières références. */
  command: string;
}

export function planCaptures(config: JourneyConfig, ui: CoverageView, scan: ScanResult, front: FrontModel, onlyTests?: string[]): CapturesPlan {
  const ctx = { states: front.states, config };
  const byTest = new Map(scan.tests.map((t) => [t.fullTitle, t]));
  const insertions = new Map<string, Insertion>();
  const unplaced: Unplaced[] = [];
  const warnings: string[] = [];

  for (const s of ui.sessions) {
    for (const st of s.states) {
      const ref = `${st.group}.${st.key}`;
      for (const cell of Object.values(st.byLocale)) {
        if (cell.status !== 'traversed') continue;
        for (const t of cell.tests) {
          if (onlyTests?.length && !onlyTests.includes(t.id)) continue;
          const test = byTest.get(t.id);
          if (!test) continue;
          if (st.kind === 'message') {
            if (!unplaced.some((u) => u.test === t.id && u.state === ref)) unplaced.push({ test: t.id, state: ref, reason: 'message d’état : la capture se fait avec un suffixe, après avoir provoqué le message' });
            continue;
          }
          const page = test.pages.find((p) => p.steps.some((h) => stepCandidates(h, ctx).includes(ref)));
          let reason: string | null = null;
          if (!page) reason = 'aucune variable de page objet pour cet écran dans le test (atteint dans un helper, ou page objet sans variable)';
          else if (!page.hasValidate) reason = `${page.className} n’a pas de validateUI()`;
          else if (page.captured) reason = `${page.variable} est déjà capturée dans ce test (mais pas cet écran : page partagée ?)`;
          else if (page.firstUseLine === null) reason = `${page.variable} n’est jamais utilisée après sa création`;
          if (reason) {
            if (!unplaced.some((u) => u.test === t.id && u.state === ref)) unplaced.push({ test: t.id, state: ref, reason });
            continue;
          }
          const key = `${test.file}|${page!.firstUseLine}|${page!.variable}`;
          const ins = insertions.get(key) ?? { file: test.file, line: page!.firstUseLine!, text: `${page!.indent}await ${page!.variable}.validateUI();`, variable: page!.variable, className: page!.className, states: [], tests: [] };
          if (!ins.states.includes(ref)) ins.states.push(ref);
          if (!ins.tests.includes(t.id)) ins.tests.push(t.id);
          insertions.set(key, ins);
        }
      }
    }
  }
  const list = [...insertions.values()].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  if (list.some((i) => i.tests.length > 1)) warnings.push('Un même emplacement sert plusieurs tests (cas pilotés par données) : une seule ligne ajoutée, une capture par langue.');
  const files = [...new Set(list.map((i) => i.file))];
  return {
    journey: config.id,
    insertions: list,
    unplaced,
    hunks: [],
    warnings,
    command: files.length ? `npx playwright test ${files.join(' ')} --update-snapshots` : '',
  };
}

/** Applique les insertions au texte (de bas en haut pour garder les numéros de ligne). */
export function applyInsertions(text: string, insertions: Insertion[]): string {
  const lines = text.split('\n');
  for (const ins of [...insertions].sort((a, b) => b.line - a.line)) lines.splice(ins.line - 1, 0, ins.text);
  return lines.join('\n');
}

/** Hunks d'aperçu (3 lignes de contexte) par fichier. */
export function hunksOf(e2e: string, insertions: Insertion[]): Hunk[] {
  const out: Hunk[] = [];
  for (const file of [...new Set(insertions.map((i) => i.file))]) {
    const ins = insertions.filter((i) => i.file === file).sort((a, b) => a.line - b.line);
    const after = applyInsertions(readFileSync(join(e2e, file), 'utf8'), ins).split('\n');
    const added = new Set(ins.map((i, k) => i.line + k)); // lignes ajoutées dans le fichier modifié
    const keep = new Set<number>();
    for (const l of added) for (let d = -3; d <= 3; d++) if (l + d >= 1 && l + d <= after.length) keep.add(l + d);
    let hunk: Hunk | null = null;
    let prev = -10;
    for (const l of [...keep].sort((a, b) => a - b)) {
      if (!hunk || l !== prev + 1) {
        hunk = { file, lines: [] };
        out.push(hunk);
      }
      hunk.lines.push({ kind: added.has(l) ? 'added' : 'context', text: after[l - 1] ?? '', line: l });
      prev = l;
    }
  }
  return out;
}

/** Commit local des captures sur une nouvelle branche (jamais la principale, jamais de push). */
export function applyCaptures(repos: Record<RepoKey, RepoInfo>, plan: CapturesPlan, now = new Date()): { branch: string; commit: string; files: string[]; command: string } {
  const e2e = repos.e2e.path;
  if (!plan.insertions.length) throw new Error('rien à appliquer');
  if (!ownGitRoot(e2e)) throw new Error('le dossier de tests n’est pas la racine de son propre dépôt git : rien n’est écrit');
  if ((git(e2e, ['status', '--porcelain']) ?? '').trim()) throw new Error('le dépôt de tests a des modifications non commitées : rien n’est écrit');
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const branch = `cc/captures-${plan.journey}-${stamp}`;
  if (git(e2e, ['switch', '--quiet', '-c', branch]) === null) throw new Error(`impossible de créer la branche ${branch}`);
  const files = [...new Set(plan.insertions.map((i) => i.file))];
  for (const f of files) {
    const p = join(e2e, f);
    writeFileSync(p, applyInsertions(readFileSync(p, 'utf8'), plan.insertions.filter((i) => i.file === f)));
  }
  git(e2e, ['add', '--', ...files]);
  const msg = `Ajoute ${plan.insertions.length} capture(s) aux tests qui traversaient déjà ces écrans (gains rapides)`;
  if (git(e2e, ['commit', '--quiet', '-m', msg]) === null) throw new Error('commit impossible');
  return { branch, commit: git(e2e, ['rev-parse', '--short', 'HEAD'])?.trim() ?? '', files, command: plan.command };
}
