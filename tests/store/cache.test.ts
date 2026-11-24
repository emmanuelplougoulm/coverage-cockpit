import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CoverageView, Suite } from '../../src/core/coverage';
import { snapshotChanged, type Snapshot } from '../../src/core/history';
import { analyzeJourney } from '../../src/engine/analyze';
import { resolveRepos } from '../../src/engine/repos';
import { cachedCoverage, readHistory, readLastViews, toolPaths, type AnalyzeDeps } from '../../src/engine/store/cache';
import { appendJsonl, readJsonl, writeJsonAtomic } from '../../src/engine/store/dataDir';
import { fingerprint, gitInfo } from '../../src/engine/store/fingerprint';
import { InputLog, inputsUnchanged } from '../../src/engine/store/inputs';
import { pilot } from '../../src/journeys/pilot';
import { CORPUS } from '../corpus';

const tmp = mkdtempSync(join(tmpdir(), 'cc-store-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('fingerprint', () => {
  const root = join(tmp, 'fp');
  cpSync(join(CORPUS.e2e, 'helpers'), root, { recursive: true });

  it('change avec le contenu ou la date hors git, pas sans rien toucher', () => {
    const a = fingerprint(root, null);
    expect(fingerprint(root, null)).toBe(a);
    writeFileSync(join(root, 'locales.ts'), "export const LOCALES = ['fr'] as const;\n");
    expect(fingerprint(root, null)).not.toBe(a);
  });

  it('ne regarde que les chemins demandés', () => {
    const a = fingerprint(root, ['mail.ts']);
    writeFileSync(join(root, 'journey.ts'), '// autre');
    expect(fingerprint(root, ['mail.ts'])).toBe(a);
  });

  it('suit index, worktree et fichiers non suivis dans git, sans commit', () => {
    const repo = join(tmp, 'repo');
    cpSync(root, repo, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    const a = fingerprint(repo, null);
    execFileSync('git', ['-C', repo, 'add', 'mail.ts']);
    const b = fingerprint(repo, null);
    expect(b).not.toBe(a);
    writeFileSync(join(repo, 'mail.ts'), '// modifié');
    expect(fingerprint(repo, null)).not.toBe(b);
    expect(gitInfo(repo, null)).toEqual({ commit: null, branch: 'main', dirty: true });
  });

  it('marque un dépôt absent', () => {
    expect(fingerprint(join(tmp, 'nope'), null)).toBe(`absent:${join(tmp, 'nope')}`);
  });
});

describe('InputLog', () => {
  it('détecte un fichier modifié et un fichier ajouté dans un dossier listé, pas une date seule', () => {
    const dir = join(tmp, 'inputs');
    cpSync(join(CORPUS.e2e, 'pages'), dir, { recursive: true });
    const log = new InputLog();
    log.dir(dir);
    log.file(join(dir, 'otp.page.ts'));
    const rec = log.record();
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(dir, 'otp.page.ts'), future, future);
    expect(inputsUnchanged(rec)).toBe(true);
    writeFileSync(join(dir, 'new.page.ts'), '');
    expect(inputsUnchanged(rec)).toBe(false);
    rmSync(join(dir, 'new.page.ts'));
    writeFileSync(join(dir, 'otp.page.ts'), '// modifié');
    expect(inputsUnchanged(rec)).toBe(false);
  });
});

describe('snapshotChanged / JSONL', () => {
  const snap = (cells: Snapshot['cells'], testsScanned = 1) => ({ testsScanned, cells });
  it('compare cellules et nombre de tests', () => {
    const prev = { at: '', journey: 'j', suite: 'ui', sources: {} as Snapshot['sources'], ...snap({ a: 'covered' }) } satisfies Snapshot;
    expect(snapshotChanged(undefined, snap({}))).toBe(true);
    expect(snapshotChanged(prev, snap({ a: 'covered' }))).toBe(false);
    expect(snapshotChanged(prev, snap({ a: 'traversed' }))).toBe(true);
    expect(snapshotChanged(prev, snap({ a: 'covered', b: 'missing' }))).toBe(true);
    expect(snapshotChanged(prev, snap({ a: 'covered' }, 2))).toBe(true);
  });

  it('ignore une ligne tronquée et un JSON corrompu', () => {
    const p = join(tmp, 'h.jsonl');
    appendJsonl(p, { n: 1 });
    writeFileSync(p, readFileSync(p, 'utf8') + '{"n": 2');
    expect(readJsonl(p)).toEqual([{ n: 1 }]);
    writeJsonAtomic(join(tmp, 'ok.json'), { a: 1 });
    expect(JSON.parse(readFileSync(join(tmp, 'ok.json'), 'utf8'))).toEqual({ a: 1 });
  });
});

describe('cachedCoverage', () => {
  // Copie du corpus : on le modifie sans toucher au vrai.
  const corpus = join(tmp, 'corpus');
  cpSync(join(CORPUS.e2e, '..'), corpus, { recursive: true });
  const repos = resolveRepos({ CC_REPO_WORKFLOW: join(corpus, 'workflow'), CC_REPO_FRONT: join(corpus, 'front'), CC_REPO_E2E: join(corpus, 'e2e') });
  const tool = join(tmp, 'tool');
  cpSync(join(CORPUS.e2e, '../../../src'), join(tool, 'src'), { recursive: true });
  let computed = 0;
  const deps = (over: Partial<AnalyzeDeps> = {}): AnalyzeDeps => ({
    repos,
    dataDir: join(tmp, 'data'),
    toolRoot: tool,
    journeyFile: 'src/journeys/pilot.ts',
    now: () => new Date('2026-11-24T10:00:00Z'),
    compute: async (log) => {
      computed++;
      return analyzeJourney(pilot, repos, log);
    },
    ...over,
  });
  beforeEach(() => {
    computed = 0;
  });

  it('analyse la première fois, écrit cache, historique et dernière vue', async () => {
    const r = await cachedCoverage(pilot, deps());
    expect([r.cache.ui.status, computed, r.cache.ui.historyAppended]).toEqual(['miss', 1, true]);
    expect(readHistory(join(tmp, 'data'), pilot.id, 'ui')).toHaveLength(1);
    expect(readLastViews(join(tmp, 'data')).map((l) => l.journey)).toEqual([pilot.id]);
  });

  it('relit le cache tant que rien ne bouge', async () => {
    const r = await cachedCoverage(pilot, deps());
    expect([r.cache.ui.status, computed]).toEqual(['hit', 0]);
  });

  it('évite l’analyse si seuls des fichiers non lus ont bougé', async () => {
    writeFileSync(join(corpus, 'e2e', 'pages', 'unused.page.ts'), 'export class Unused {}\n');
    const r = await cachedCoverage(pilot, deps());
    expect([r.cache.ui.status, computed]).toEqual(['inputs', 0]);
    expect((await cachedCoverage(pilot, deps())).cache.ui.status).toBe('hit');
  });

  it('réanalyse si un fichier lu change ; n’ajoute à l’historique que si la couverture change', async () => {
    const spec = join(corpus, 'e2e', 'tests', 'ui', 'pilot-account-opening', 'nominal.spec.ts');
    writeFileSync(spec, readFileSync(spec, 'utf8') + '\n// commentaire\n');
    const r = await cachedCoverage(pilot, deps());
    expect([r.cache.ui.status, computed, r.cache.ui.historyAppended]).toEqual(['miss', 1, false]);

    writeFileSync(spec, readFileSync(spec, 'utf8').replace('await summary.validateUI();', ''));
    const r2 = await cachedCoverage(pilot, deps());
    expect([r2.cache.ui.status, r2.cache.ui.historyAppended, r2.cache.workflow.historyAppended]).toEqual(['miss', true, false]);
    const hist = readHistory(join(tmp, 'data'), pilot.id, 'ui');
    // Sans validateUI(), la page objet est seulement construite : l'écran n'est pas atteint.
    expect(hist.map((h) => h.cells['S|CLOSING_STEPS.summary|fr'])).toEqual(['covered', 'missing']);
  });

  it('ne réutilise pas le cache si l’outil change, réanalyse toujours avec --force', async () => {
    writeFileSync(join(tool, 'src', 'engine', 'cli.ts'), '// changé\n');
    expect((await cachedCoverage(pilot, deps())).cache.ui.status).toBe('miss');
    expect((await cachedCoverage(pilot, deps({ force: true }))).cache.ui.status).toBe('forced');
    expect(computed).toBe(2);
  });

  it('ignore la config d’un autre parcours et les tests de l’outil', async () => {
    await cachedCoverage(pilot, deps());
    writeFileSync(join(tool, 'src', 'journeys', 'other.ts'), 'export const other = 1;\n');
    writeFileSync(join(tool, 'src', 'journeys', 'index.ts'), '// un parcours de plus\n');
    expect((await cachedCoverage(pilot, deps())).cache.ui.status).toBe('hit');
    expect(toolPaths('src/journeys/pilot.ts')).not.toContain('tests');
  });

  it('rend les deux suites', async () => {
    const r = await cachedCoverage(pilot, deps());
    const suites: Suite[] = ['ui', 'workflow'];
    expect(suites.map((s) => (r.views[s] as CoverageView).suite)).toEqual(suites);
  });
});
