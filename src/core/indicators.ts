import type { Cell, CoverageView, ReachStatus, TestRef } from './coverage';
import type { CellStatus } from './fixture';
import type { Snapshot } from './history';

/**
 * Indicateurs de la vue d'ensemble (§7). Fonctions pures sur une vue ou un
 * historique. La zone grise n'entre dans aucun pourcentage.
 */

/** Clé d'état « erreur » (§7, effort nominal vs erreur). */
export const ERROR_KEY = /error|retry|blocked|no_?retries|expiration|nomoreattempts|permission|fail/i;

export interface CellRef {
  /** Clé de cellule (§10) : `S|GROUP.KEY|locale` ou `E|template|variant|locale`. */
  key: string;
  kind: 'screen' | 'email';
  /** "GROUP.KEY" ou "email:<gabarit>/<variante>". */
  ref: string;
  locale: string;
  isError: boolean;
  cell: Cell;
}

export function cellsOf(view: CoverageView): CellRef[] {
  const out: CellRef[] = [];
  for (const s of view.sessions) {
    for (const st of s.states) {
      for (const [locale, cell] of Object.entries(st.byLocale)) {
        const ref = `${st.group}.${st.key}`;
        out.push({ key: `S|${ref}|${locale}`, kind: 'screen', ref, locale, isError: ERROR_KEY.test(st.key), cell });
      }
    }
  }
  for (const e of view.emails) {
    for (const v of e.variants) {
      for (const [locale, cell] of Object.entries(v.byLocale)) {
        out.push({ key: `E|${e.template}|${v.variant}|${locale}`, kind: 'email', ref: `email:${e.template}/${v.variant}`, locale, isError: false, cell });
      }
    }
  }
  return out;
}

const ratio = (n: number, d: number): number | null => (d ? n / d : null);

export interface QuickWinStep {
  test: TestRef;
  /** Cellules traversées que ce test capturerait en ajoutant une capture. */
  cells: string[];
}

/**
 * Gains rapides (§7) : cellules traversées jamais capturées, regroupées de
 * façon gloutonne par test — l'ordre qui capture tout en retouchant le moins
 * de tests. `curve[i]` = cellules capturées après i+1 tests retouchés.
 */
export function quickWins(cells: CellRef[]): { cells: number; plan: QuickWinStep[]; curve: number[] } {
  const traversed = cells.filter((c) => c.cell.status === 'traversed');
  const byTest = new Map<string, { test: TestRef; cells: Set<string> }>();
  for (const c of traversed) {
    for (const t of c.cell.tests) {
      const e = byTest.get(t.id) ?? { test: t, cells: new Set<string>() };
      e.cells.add(c.key);
      byTest.set(t.id, e);
    }
  }
  const left = new Set(traversed.map((c) => c.key));
  const plan: QuickWinStep[] = [];
  const curve: number[] = [];
  while (left.size) {
    let best: { test: TestRef; gain: string[] } | null = null;
    for (const e of [...byTest.values()].sort((a, b) => (a.test.id < b.test.id ? -1 : 1))) {
      const gain = [...e.cells].filter((k) => left.has(k));
      if (!best || gain.length > best.gain.length) best = { test: e.test, gain };
    }
    if (!best || !best.gain.length) break;
    best.gain.forEach((k) => left.delete(k));
    plan.push({ test: best.test, cells: best.gain.sort() });
    curve.push((curve.at(-1) ?? 0) + best.gain.length);
  }
  return { cells: traversed.length, plan, curve };
}

export interface StateEffort {
  ref: string;
  locale: string;
  tests: number;
  captures: number;
  isError: boolean;
  status: ReachStatus;
}

export interface Indicators {
  cells: number;
  reached: number;
  covered: number;
  /** Atteintes / cellules. */
  coverage: number | null;
  /** Capturées / cellules. */
  verification: number | null;
  /** Atteintes jamais capturées / atteintes : « illusion de couverture ». */
  illusion: number | null;
  quickWins: ReturnType<typeof quickWins>;
  effort: {
    perCell: StateEffort[];
    nominal: { cells: number; reached: number };
    error: { cells: number; reached: number };
    /** Part des cellules d'erreur parmi les cellules atteintes. */
    errorShareOfReached: number | null;
  };
  /** Cellules atteintes par un seul test. */
  fragile: CellRef[];
  /** État atteint dans une langue, absent dans une autre. */
  languageGaps: { ref: string; reachedIn: string[]; missingIn: string[] }[];
  grey: { ambiguous: number; unattributed: number; unlinked: number; unknownLocale: number; total: number };
  /** Nombre de tests par cellule d'écran : 0, 1, 2, 3, 4+. */
  histogram: { bucket: string; count: number }[];
}

export function indicators(view: CoverageView): Indicators {
  const cells = cellsOf(view);
  const reached = cells.filter((c) => c.cell.status !== 'missing');
  const covered = cells.filter((c) => c.cell.status === 'covered');
  const screens = cells.filter((c) => c.kind === 'screen');

  const nominal = screens.filter((c) => !c.isError);
  const error = screens.filter((c) => c.isError);
  const reachedScreens = screens.filter((c) => c.cell.status !== 'missing');

  const byRef = new Map<string, CellRef[]>();
  for (const c of screens) byRef.set(c.ref, [...(byRef.get(c.ref) ?? []), c]);
  const languageGaps = [...byRef.entries()]
    .map(([ref, cs]) => ({
      ref,
      reachedIn: cs.filter((c) => c.cell.status !== 'missing').map((c) => c.locale),
      missingIn: cs.filter((c) => c.cell.status === 'missing').map((c) => c.locale),
    }))
    .filter((g) => g.reachedIn.length && g.missingIn.length);

  const buckets = ['0', '1', '2', '3', '4+'];
  const histogram = buckets.map((bucket, i) => ({
    bucket,
    count: screens.filter((c) => (i === 4 ? c.cell.tests.length >= 4 : c.cell.tests.length === i)).length,
  }));

  const grey = {
    ambiguous: view.ambiguous.length,
    unattributed: view.unattributed.length,
    unlinked: view.bpmn.filter((b) => b.status === 'unlinked').length,
    unknownLocale: view.unknownLocaleTests.length,
    total: 0,
  };
  grey.total = grey.ambiguous + grey.unattributed + grey.unlinked + grey.unknownLocale;

  return {
    cells: cells.length,
    reached: reached.length,
    covered: covered.length,
    coverage: ratio(reached.length, cells.length),
    verification: ratio(covered.length, cells.length),
    illusion: ratio(reached.length - covered.length, reached.length),
    quickWins: quickWins(cells),
    effort: {
      perCell: screens.map((c) => ({ ref: c.ref, locale: c.locale, tests: c.cell.tests.length, captures: c.cell.capturedBy.length, isError: c.isError, status: c.cell.status })),
      nominal: { cells: nominal.length, reached: nominal.filter((c) => c.cell.status !== 'missing').length },
      error: { cells: error.length, reached: error.filter((c) => c.cell.status !== 'missing').length },
      errorShareOfReached: ratio(reachedScreens.filter((c) => c.isError).length, reachedScreens.length),
    },
    fragile: reached.filter((c) => c.cell.tests.length === 1),
    languageGaps,
    grey,
    histogram,
  };
}

// ——— historique ———

export interface TrendPoint {
  at: string;
  coverage: number | null;
  verification: number | null;
  cells: number;
}

/** Couverture et vérification à chaque instantané (cellules écran + e-mail, hors BPMN). */
export function trend(snapshots: Snapshot[]): TrendPoint[] {
  return snapshots.map((s) => {
    const vals = Object.entries(s.cells).filter(([k]) => k.startsWith('S|') || k.startsWith('E|')).map(([, v]) => v);
    return {
      at: s.at,
      cells: vals.length,
      coverage: ratio(vals.filter((v) => v === 'traversed' || v === 'covered').length, vals.length),
      verification: ratio(vals.filter((v) => v === 'covered').length, vals.length),
    };
  });
}

const RANK: Partial<Record<CellStatus, number>> = { missing: 0, traversed: 1, covered: 2 };

export interface SinceVisit {
  /** Instantané de référence (le dernier avant la visite), absent si le parcours est nouveau. */
  from: string | null;
  to: string | null;
  improved: string[];
  worsened: string[];
  added: string[];
  removed: string[];
}

/** Ce qui a bougé depuis la dernière visite (§7). */
export function sinceVisit(snapshots: Snapshot[], visitAt: string | null): SinceVisit {
  const latest = snapshots.at(-1);
  const base = visitAt ? [...snapshots].reverse().find((s) => s.at <= visitAt) : undefined;
  const empty: SinceVisit = { from: base?.at ?? null, to: latest?.at ?? null, improved: [], worsened: [], added: [], removed: [] };
  if (!latest || !visitAt || base === latest) return empty;
  const prev = base?.cells ?? {};
  for (const [k, v] of Object.entries(latest.cells)) {
    const p = prev[k];
    if (p === undefined) {
      if (base) empty.added.push(k);
      continue;
    }
    const a = RANK[p];
    const b = RANK[v];
    if (a === undefined || b === undefined) continue;
    if (b > a) empty.improved.push(k);
    else if (b < a) empty.worsened.push(k);
  }
  if (base) for (const k of Object.keys(prev)) if (!(k in latest.cells)) empty.removed.push(k);
  return empty;
}

// ——— actions suggérées ———

export interface SuggestedAction {
  kind: 'quick-win' | 'fragile' | 'language' | 'grey';
  journey: string;
  text: string;
  /** Cellules en jeu : sert au tri. */
  weight: number;
}

export function suggestedActions(journey: string, ind: Indicators): SuggestedAction[] {
  const out: SuggestedAction[] = [];
  for (const step of ind.quickWins.plan.slice(0, 3)) {
    out.push({
      kind: 'quick-win',
      journey,
      weight: step.cells.length,
      text: `Ajouter des captures dans « ${step.test.id.split(' › ').at(-1)} » : +${step.cells.length} cellule${step.cells.length > 1 ? 's' : ''} vérifiée${step.cells.length > 1 ? 's' : ''}`,
    });
  }
  if (ind.fragile.length) {
    out.push({ kind: 'fragile', journey, weight: ind.fragile.length, text: `${ind.fragile.length} cellule${ind.fragile.length > 1 ? 's reposent' : ' repose'} sur un seul test` });
  }
  if (ind.languageGaps.length) {
    const g = ind.languageGaps[0]!;
    const more = ind.languageGaps.length - 1;
    out.push({
      kind: 'language',
      journey,
      weight: ind.languageGaps.length,
      text: `${g.ref} atteint en ${g.reachedIn.join(', ')}, jamais en ${g.missingIn.join(', ')}${more ? ` (+${more} autre${more > 1 ? 's' : ''})` : ''}`,
    });
  }
  if (ind.grey.total) {
    const parts = [
      ind.grey.ambiguous && `${ind.grey.ambiguous} ambiguïté${ind.grey.ambiguous > 1 ? 's' : ''}`,
      ind.grey.unlinked && `${ind.grey.unlinked} élément${ind.grey.unlinked > 1 ? 's' : ''} BPMN sans lien`,
      ind.grey.unattributed && `${ind.grey.unattributed} e-mail${ind.grey.unattributed > 1 ? 's' : ''} non attribué${ind.grey.unattributed > 1 ? 's' : ''}`,
      ind.grey.unknownLocale && `${ind.grey.unknownLocale} test${ind.grey.unknownLocale > 1 ? 's' : ''} de langue inconnue`,
    ].filter(Boolean);
    out.push({ kind: 'grey', journey, weight: ind.grey.total, text: `Trancher la zone grise : ${parts.join(', ')}` });
  }
  return out;
}
