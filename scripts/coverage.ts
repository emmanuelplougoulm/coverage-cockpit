import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { diffCells, viewCells, type Suite } from '../src/core/coverage';
import { parseExpectedCoverage, type ExpectedCoverage } from '../src/core/fixture';
import { analyzeJourney } from '../src/engine/analyze';
import { loadKnowledge } from '../src/engine/knowledge/load';
import { resolveRepos } from '../src/engine/repos';
import { journeys, PILOT_ID } from '../src/journeys';

/**
 * `pnpm coverage` : recalcule la couverture du pilote et la compare à la
 * fixture figée. Code de sortie 1 s'il y a la moindre différence.
 * `pnpm coverage --write` réécrit les cellules (le drapeau `frozen` est conservé).
 */
const path = fileURLToPath(new URL('../fixtures/pilot/expected-coverage.json', import.meta.url));
const expected = parseExpectedCoverage(JSON.parse(readFileSync(path, 'utf8')));
const pilot = journeys.find((j) => j.id === PILOT_ID)!;
const suites: Suite[] = ['ui', 'workflow'];
// Sans cache : la référence se compare toujours à une analyse complète.
const views = analyzeJourney(pilot, resolveRepos(), undefined, loadKnowledge(fileURLToPath(new URL('../knowledge', import.meta.url))));
const actual = Object.fromEntries(
  suites.map((s) => [s, { testsScanned: views[s].testsScanned, cells: viewCells(views[s]) }]),
) as ExpectedCoverage['suites'];

if (process.argv.includes('--write')) {
  const next: ExpectedCoverage = { ...expected, suites: actual };
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n');
  console.log(`fixture réécrite (${Object.keys(actual.ui.cells).length} + ${Object.keys(actual.workflow.cells).length} cellules, frozen: ${expected.frozen})`);
} else {
  let total = 0;
  for (const s of suites) {
    const d = diffCells(expected.suites[s].cells, actual[s].cells);
    if (expected.suites[s].testsScanned !== actual[s].testsScanned) {
      console.log(`[${s}] testsScanned : attendu ${expected.suites[s].testsScanned}, obtenu ${actual[s].testsScanned}`);
      total++;
    }
    for (const x of d) console.log(`[${s}] ${x.key} : attendu ${x.expected ?? '—'}, obtenu ${x.actual ?? '—'}`);
    total += d.length;
  }
  console.log(total === 0 ? `0 différence avec la couverture ${expected.frozen ? 'figée' : 'attendue (non figée)'} du pilote` : `${total} différence(s)`);
  process.exitCode = total === 0 ? 0 : 1;
}
