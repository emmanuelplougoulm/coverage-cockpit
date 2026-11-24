import type { CellStatus } from './fixture';
import type { NominalPath } from './journey';
import type { BrickAssignment } from './knowledge';

/** Catalogue de décisions appliqué : ce qui a été décidé par lui, et ce qui reste à trancher. */
export interface CatalogOutcome {
  applied: { decision: string; target: string; value: string }[];
  pending: { decision: string; target: string; candidates: string[]; why: string }[];
}

/**
 * Vue de couverture d'un parcours (§6), telle que le moteur l'imprime et que
 * l'UI l'affiche. Ce que l'outil ne peut pas trancher est listé à part
 * (`ambiguous`, `unattributed`, `unknownLocaleTests`, statut `unlinked`) et
 * n'entre jamais dans les pourcentages.
 */

export type Suite = 'ui' | 'workflow';

/** Référence d'un test : le titre complet est la clé (tests pilotés par données). */
export interface TestRef {
  id: string;
  file: string;
  line: number;
}

/** Statut d'une cellule écran × langue ou e-mail × variante × langue. */
export type ReachStatus = 'missing' | 'traversed' | 'covered';

/** Un test qui capture la cellule, avec son image de référence si le dépôt en a une. */
export interface CaptureRef extends TestRef {
  /** Nom passé à toHaveScreenshot. */
  shot?: string;
  /** Image de référence, relative au dépôt de tests. */
  image?: string;
}

export interface Cell {
  status: ReachStatus;
  /** Tests qui atteignent la cellule (capturants compris). */
  tests: TestRef[];
  /** Tests qui la capturent. */
  capturedBy: CaptureRef[];
}

export interface StateCoverage {
  group: string;
  key: string;
  kind: 'step' | 'message';
  stepName?: string;
  /** Langues où le front a un texte pour cet état. */
  textLocales: string[];
  byLocale: Record<string, Cell>;
}

export interface SessionCoverage {
  group: string;
  label: string;
  states: StateCoverage[];
}

export interface EmailVariantCoverage {
  variant: string;
  byLocale: Record<string, Cell>;
}

export interface EmailCoverage {
  template: string;
  taskId: string;
  trigger: string;
  /** Le gabarit n'existe pas dans le front. */
  missingTemplate: boolean;
  variants: EmailVariantCoverage[];
}

export interface ExcludedItem {
  id: string;
  reason: string;
}

export interface BpmnCoverageElement {
  id: string;
  kind: 'session' | 'email' | 'branch';
  label: string;
  status: CellStatus;
  /** États ("GROUP.KEY") ou e-mails ("email:<template>") qui le prouvent. */
  links: string[];
  /** D'où vient le lien : config, nom de session, catalogue… */
  source?: string;
  /** Sous-processus englobants (e-mails, branches). */
  scope?: string[];
  reason?: string;
}

export interface Ambiguity {
  /** Classe, marqueur ou suffixe qui n'a pas pu être tranché. */
  marker: string;
  candidates: string[];
  tests: TestRef[];
}

export interface UnattributedEmail {
  subject: string;
  reason: 'shared-subject' | 'unknown-subject' | 'variant';
  templates: string[];
  tests: TestRef[];
}

/** D'où vient le chemin nominal (§8) ; une proposition BPMN n'est jamais un contrôle. */
export interface NominalResolution {
  source: 'config' | 'p1' | 'bpmn' | null;
  confidence: 'haute' | 'moyenne' | 'basse' | null;
  paths: NominalPath[];
  evidence?: string;
}

export interface CoverageView {
  journey: string;
  suite: Suite;
  locales: string[];
  testsScanned: number;
  /** Tests rattachés au parcours (specs du parcours + specs partagées qui appellent un configurateur). */
  tests: TestRef[];
  sessions: SessionCoverage[];
  emails: EmailCoverage[];
  /** Gabarits du front qu'aucun e-mail du BPMN n'envoie. */
  orphanTemplates: string[];
  bpmn: BpmnCoverageElement[];
  excluded: ExcludedItem[];
  ambiguous: Ambiguity[];
  unattributed: UnattributedEmail[];
  unknownLocaleTests: TestRef[];
  /** Chemins nominaux et leur source. */
  nominal: NominalResolution;
  /** Écrans dont la clé dit « erreur » mais qui terminent une escalade (config). */
  escalationEnds: string[];
  /** Graphe des cartes d'étapes du front (familles, plan de tests). */
  transitions: { from: string; to: string[] }[];
  /** Texte principal de chaque état (titre ou message) dans la langue par défaut : regroupe les erreurs techniques. */
  texts: Record<string, string>;
  /** Tags effectifs de chaque test rattaché (describe englobants puis option `tag`), par titre complet. */
  testTags: Record<string, string[]>;
  /** Catalogue de décisions appliqué (configs `catalog: true`). */
  catalog: CatalogOutcome;
  /** Briques métier des groupes, états particuliers et sous-processus (`bpmn:<id>`). */
  bricks: BrickAssignment[];
  /** Assertions de chaque test rattaché (contrôles et gardes), par titre complet. */
  testChecks: Record<string, { check: string; kind: 'control' | 'guard'; strength: 'valeur' | 'presence' | 'visuel'; line: number; owner: string | null }[]>;
  /** Sessions soumises par chaque test (tests workflow), par titre complet. */
  testSessions: Record<string, string[]>;
  warnings: string[];
}

/** Clés de cellules (§10) : base de l'historique et de la fixture du pilote. */
export function viewCells(view: CoverageView): Record<string, CellStatus> {
  const cells: Record<string, CellStatus> = {};
  for (const s of view.sessions) {
    for (const st of s.states) {
      for (const [loc, c] of Object.entries(st.byLocale)) cells[`S|${st.group}.${st.key}|${loc}`] = c.status;
    }
  }
  for (const e of view.emails) {
    for (const v of e.variants) {
      for (const [loc, c] of Object.entries(v.byLocale)) cells[`E|${e.template}|${v.variant}|${loc}`] = c.status;
    }
  }
  for (const b of view.bpmn) cells[`B|${b.id}`] = b.status;
  return Object.fromEntries(Object.entries(cells).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Différences entre deux jeux de cellules : clé → [attendu, obtenu]. */
export function diffCells(
  expected: Record<string, CellStatus>,
  actual: Record<string, CellStatus>,
): { key: string; expected: CellStatus | null; actual: CellStatus | null }[] {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return keys
    .filter((k) => expected[k] !== actual[k])
    .map((k) => ({ key: k, expected: expected[k] ?? null, actual: actual[k] ?? null }));
}

export interface ViewSummary {
  /** Cellules écran × langue et e-mail × variante × langue. */
  cells: number;
  reached: number;
  covered: number;
  /** Ambigus, e-mails non attribués, éléments BPMN sans lien, tests de langue inconnue. */
  grey: number;
}

/** Comptes de base d'une vue (les indicateurs détaillés viennent au jalon 5). */
export function summarizeView(view: CoverageView): ViewSummary {
  const all = [
    ...view.sessions.flatMap((s) => s.states.flatMap((st) => Object.values(st.byLocale))),
    ...view.emails.flatMap((e) => e.variants.flatMap((v) => Object.values(v.byLocale))),
  ];
  return {
    cells: all.length,
    reached: all.filter((c) => c.status !== 'missing').length,
    covered: all.filter((c) => c.status === 'covered').length,
    grey: view.ambiguous.length + view.unattributed.length + view.unknownLocaleTests.length + view.bpmn.filter((b) => b.status === 'unlinked').length,
  };
}
