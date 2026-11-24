/** Statut d'une cellule (§6, §10). */
export type CellStatus = 'missing' | 'traversed' | 'covered' | 'excluded' | 'unlinked';

/** Clé de cellule : `S|GROUP.KEY|locale`, `E|template|variant|locale` ou `B|elementId`. */
export const CELL_KEY = /^(S\|[A-Z][A-Z0-9_]*\.[A-Za-z0-9_]+\|[a-z]{2}(-[A-Z]{2})?|E\|[^|]+\|[^|]+\|[a-z]{2}(-[A-Z]{2})?|B\|[^|]+)$/;

const STATUSES: readonly CellStatus[] = ['missing', 'traversed', 'covered', 'excluded', 'unlinked'];
const SUITES = ['ui', 'workflow'] as const;

export interface SuiteSnapshot {
  testsScanned: number;
  cells: Record<string, CellStatus>;
}

/** Couverture figée d'un parcours, référence de non-régression. */
export interface ExpectedCoverage {
  journey: string;
  /** Faux tant que la référence n'a pas été validée à la main. */
  frozen: boolean;
  note: string;
  suites: Record<(typeof SUITES)[number], SuiteSnapshot>;
}

function parseSuite(raw: unknown, name: string): SuiteSnapshot {
  if (typeof raw !== 'object' || raw === null) throw new Error(`fixture : suite ${name} manquante`);
  const o = raw as Record<string, unknown>;
  if (typeof o.testsScanned !== 'number') throw new Error(`fixture : ${name}.testsScanned nombre attendu`);
  if (typeof o.cells !== 'object' || o.cells === null) throw new Error(`fixture : ${name}.cells objet attendu`);
  const cells: Record<string, CellStatus> = {};
  for (const [k, v] of Object.entries(o.cells)) {
    if (!CELL_KEY.test(k)) throw new Error(`fixture : clé de cellule mal formée ${k}`);
    if (!STATUSES.includes(v as CellStatus)) throw new Error(`fixture : statut inconnu ${String(v)} pour ${k}`);
    cells[k] = v as CellStatus;
  }
  return { testsScanned: o.testsScanned, cells };
}

export function parseExpectedCoverage(raw: unknown): ExpectedCoverage {
  if (typeof raw !== 'object' || raw === null) throw new Error('fixture : objet attendu');
  const o = raw as Record<string, unknown>;
  if (typeof o.journey !== 'string' || !o.journey) throw new Error('fixture : `journey` manquant');
  if (typeof o.frozen !== 'boolean') throw new Error('fixture : `frozen` booléen attendu');
  if (typeof o.suites !== 'object' || o.suites === null) throw new Error('fixture : `suites` objet attendu');
  const s = o.suites as Record<string, unknown>;
  const suites = { ui: parseSuite(s.ui, 'ui'), workflow: parseSuite(s.workflow, 'workflow') };
  if (o.frozen && Object.keys(suites.ui.cells).length === 0) throw new Error('fixture figée sans cellule');
  return { journey: o.journey, frozen: o.frozen, note: typeof o.note === 'string' ? o.note : '', suites };
}
