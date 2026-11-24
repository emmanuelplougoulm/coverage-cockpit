
import { describe, expect, it } from 'vitest';
import type { CoverageView } from '../src/core/coverage';
import type { Snapshot } from '../src/core/history';
import { indicators, quickWins, sinceVisit, suggestedActions, trend, type CellRef } from '../src/core/indicators';
import { analyzeJourney } from '../src/engine/analyze';
import { resolveRepos } from '../src/engine/repos';
import { pilot } from '../src/journeys/pilot';
import { CORPUS } from './corpus';

const repos = resolveRepos({ CC_REPO_WORKFLOW: CORPUS.workflow, CC_REPO_FRONT: CORPUS.front, CC_REPO_E2E: CORPUS.e2e });
const views = analyzeJourney(pilot, repos);
const ui = indicators(views.ui);

const t = (id: string) => ({ id, file: 'f', line: 1 });
const cell = (key: string, tests: string[], status: 'missing' | 'traversed' | 'covered' = 'traversed'): CellRef => ({
  key, kind: 'screen', ref: key, locale: 'fr', isError: false, cell: { status, tests: tests.map(t), capturedBy: [] },
});

describe('indicators — pilote', () => {
  it('compte cellules, couverture, vérification et illusion', () => {
    expect([ui.cells, ui.reached, ui.covered]).toEqual([59, 16, 9]);
    expect(ui.coverage).toBeCloseTo(16 / 59);
    expect(ui.illusion).toBeCloseTo(7 / 16);
  });

  it('sépare nominal et erreur, et repère la fragilité et les écarts de langue', () => {
    expect(ui.effort.error.cells).toBeGreaterThan(0);
    expect(ui.effort.nominal.cells + ui.effort.error.cells).toBe(46);
    expect(ui.fragile.map((c) => c.key)).toContain('S|SCAN_ID_STEPS.captureV2|fr');
    expect(ui.languageGaps.map((g) => g.ref)).toContain('SIGNATURE_STEPS.helperTextOnError');
  });

  it('compte la zone grise à part', () => {
    expect(ui.grey).toEqual({ ambiguous: 0, unattributed: 0, unlinked: 1, unknownLocale: 1, total: 2 });
  });

  it('histogramme : chaque cellule d’écran dans un seul seau', () => {
    expect(ui.histogram.reduce((n, b) => n + b.count, 0)).toBe(46);
  });

  it('propose des actions triables', () => {
    const a = suggestedActions(pilot.id, ui);
    expect(a.map((x) => x.kind)).toEqual(['quick-win', 'quick-win', 'quick-win', 'fragile', 'language', 'grey']);
    expect(a.at(-1)?.text).toBe('Trancher la zone grise : 1 élément BPMN sans lien, 1 test de langue inconnue');
  });
});

describe('quickWins', () => {
  it('choisit d’abord le test qui capture le plus, puis le reste', () => {
    const q = quickWins([cell('a', ['T1', 'T2']), cell('b', ['T2']), cell('c', ['T2']), cell('d', ['T3']), cell('e', ['T1'], 'covered')]);
    expect(q.plan.map((s) => [s.test.id, s.cells])).toEqual([
      ['T2', ['a', 'b', 'c']],
      ['T3', ['d']],
    ]);
    expect(q.curve).toEqual([3, 4]);
    expect(q.cells).toBe(4);
  });
});

const snap = (at: string, cells: Snapshot['cells']): Snapshot => ({
  at, journey: 'j', suite: 'ui', testsScanned: 1, cells,
  sources: { tests: { commit: null, branch: null, dirty: false }, front: { commit: null, branch: null, dirty: false }, workflow: { commit: null, branch: null, dirty: false } },
});

describe('trend / sinceVisit', () => {
  const h = [
    snap('2026-11-01T00:00:00Z', { 'S|A.x|fr': 'missing', 'S|A.y|fr': 'traversed', 'B|b': 'covered' }),
    snap('2026-11-10T00:00:00Z', { 'S|A.x|fr': 'covered', 'S|A.y|fr': 'missing', 'S|A.z|fr': 'missing' }),
  ];

  it('calcule couverture et vérification hors cellules BPMN', () => {
    expect(trend(h)).toEqual([
      { at: '2026-11-01T00:00:00Z', cells: 2, coverage: 0.5, verification: 0 },
      { at: '2026-11-10T00:00:00Z', cells: 3, coverage: 1 / 3, verification: 1 / 3 },
    ]);
  });

  it('compare au dernier instantané d’avant la visite', () => {
    expect(sinceVisit(h, '2026-11-05T00:00:00Z')).toEqual({
      from: '2026-11-01T00:00:00Z', to: '2026-11-10T00:00:00Z',
      improved: ['S|A.x|fr'], worsened: ['S|A.y|fr'], added: ['S|A.z|fr'], removed: ['B|b'],
    });
  });

  it('ne dit rien sans visite ni changement depuis', () => {
    expect(sinceVisit(h, null).improved).toEqual([]);
    expect(sinceVisit(h, '2026-11-20T00:00:00Z').improved).toEqual([]);
  });
});

describe('fixture vide', () => {
  it('ne divise jamais par zéro', () => {
    const empty = JSON.parse(JSON.stringify(views.ui)) as CoverageView;
    empty.sessions = [];
    empty.emails = [];
    expect(indicators(empty)).toMatchObject({ cells: 0, coverage: null, verification: null, illusion: null });

  });
});
