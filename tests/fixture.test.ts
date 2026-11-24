import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffCells } from '../src/core/coverage';
import { parseExpectedCoverage } from '../src/core/fixture';
import { PILOT_ID } from '../src/journeys';

const suites = (ui: Record<string, string>, frozen = true) => ({
  journey: 'j',
  frozen,
  note: '',
  suites: { ui: { testsScanned: 1, cells: ui }, workflow: { testsScanned: 0, cells: {} } },
});

describe('fixture du pilote', () => {
  const raw = JSON.parse(readFileSync(new URL('../fixtures/pilot/expected-coverage.json', import.meta.url), 'utf8'));

  it('se lit, vise le pilote et porte les deux suites', () => {
    const f = parseExpectedCoverage(raw);
    expect(f.journey).toBe(PILOT_ID);
    expect(Object.keys(f.suites.ui.cells).length).toBeGreaterThan(0);
    expect(Object.keys(f.suites.workflow.cells).length).toBeGreaterThan(0);
  });
});

describe('parseExpectedCoverage', () => {
  it('accepte les trois formes de cellule', () => {
    const cells = { 'S|A_STEPS.k|fr': 'covered', 'E|tpl|premium/default|en': 'traversed', 'B|review/approved': 'unlinked' };
    expect(parseExpectedCoverage(suites(cells)).suites.ui.cells).toEqual(cells);
  });

  it('refuse une clé ou un statut inconnus, une suite manquante', () => {
    expect(() => parseExpectedCoverage(suites({ 'X|a': 'covered' }))).toThrow(/clé/);
    expect(() => parseExpectedCoverage(suites({ 'B|e': 'done' }))).toThrow(/statut/);
    expect(() => parseExpectedCoverage({ journey: 'j', frozen: false, suites: { ui: { testsScanned: 0, cells: {} } } })).toThrow(/workflow/);
  });

  it('refuse une fixture figée vide', () => {
    expect(() => parseExpectedCoverage(suites({}))).toThrow(/figée sans cellule/);
    expect(parseExpectedCoverage(suites({}, false)).frozen).toBe(false);
  });
});

describe('diffCells', () => {
  it('liste changements, apparitions et disparitions', () => {
    expect(diffCells({ a: 'covered', b: 'missing' }, { a: 'traversed', c: 'missing' })).toEqual([
      { key: 'a', expected: 'covered', actual: 'traversed' },
      { key: 'b', expected: 'missing', actual: null },
      { key: 'c', expected: null, actual: 'missing' },
    ]);
    expect(diffCells({ a: 'covered' }, { a: 'covered' })).toEqual([]);
  });
});
