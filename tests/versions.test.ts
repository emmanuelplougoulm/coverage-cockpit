import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bpmnVersions, makeWorkflowHistory } from '../fixtures/corpus/tools/workflowHistory';
import { analyzeJourney } from '../src/engine/analyze';
import { parseBpmn } from '../src/engine/parsers/bpmn';
import { resolveRepos } from '../src/engine/repos';
import { diffBpmn } from '../src/engine/versions/diff';
import { compareVersions, fetchAndUpdate, ticketsIn, versionsOf } from '../src/engine/versions/history';
import { allVersions, defaultRange, impactsBetween, markSeen } from '../src/engine/versions';
import { pilot } from '../src/journeys/pilot';
import { CORPUS } from './corpus';

const tmp = mkdtempSync(join(tmpdir(), 'cc-versions-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const DIR = 'processes/pilot-account-opening';
const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' }, stdio: ['ignore', 'pipe', 'ignore'] }).toString();

describe('diffBpmn', () => {
  const v = bpmnVersions();
  const d = (a: string, b: string) => diffBpmn(parseBpmn(a), parseBpmn(b));

  it('ajouts, recâblage et e-mails apparus', () => {
    const x = d(v.v300, v.v310);
    expect(x.added.map((e) => e.id).sort()).toEqual(['email_advisor', 'fraud-check', 'rev_f_adv', 'rev_f_fraud', 'rev_fraud']);
    expect(x.modified.find((e) => e.id === 'more-documents')).toMatchObject({ reasons: ['wiring'], scope: ['review'] });
    expect(x.emails).toEqual({ added: ['advisor-notification'], removed: [] });
  });

  it('configuration et condition', () => {
    expect(d(v.v320, v.v330).modified).toEqual([{ id: 'email_welcome', type: 'serviceTask', name: 'Send welcome email', scope: [], reasons: ['configuration'] }]);
    const cond = parseBpmn(v.v320.replace('=fraudScore &gt; 80', '=fraudScore &gt; 90'));
    expect(diffBpmn(parseBpmn(v.v320), cond).modified.map((m) => [m.id, m.reasons])).toEqual([['fraud-check', ['condition']]]);
  });

  it('suppressions dans l’autre sens, et rien entre deux copies identiques', () => {
    expect(d(v.v320, v.v310).removed.map((e) => e.id)).toEqual(['sig_f4', 'sig_blocked', 'sig_f6', 'sig_end_locked']);
    const same = d(v.v320, v.v320);
    expect([same.added, same.removed, same.modified]).toEqual([[], [], []]);
  });
});

describe('versionsOf / fetchAndUpdate (historique du corpus)', () => {
  const h = makeWorkflowHistory(join(tmp, 'h1'));

  it('avant fetch : les versions locales, rien de distant', () => {
    const v = versionsOf('p', h.workflow, DIR, null);
    expect(v.versions.map((x) => x.version)).toEqual(['3.0.0', '3.1.0', '3.2.0']);
    expect(v.versions[1]).toMatchObject({ tickets: ['PILOT-114', 'PILOT-120'], remoteOnly: false });
    expect(v.versions[1]!.commits.map((c) => c.subject)).not.toContain('Version 3.1.0');
    expect(v.localVersion).toBe('3.2.0');
  });

  it('un clone sale n’est pas avancé, mais les versions distantes apparaissent', () => {
    writeFileSync(join(h.workflow, 'notes.txt'), 'brouillon');
    const f = fetchAndUpdate(h.workflow);
    expect(f).toEqual({ attempted: true, ok: true, updated: false, skipped: 'modifications locales non commitées' });
    const v = versionsOf('p', h.workflow, DIR, '3.2.0');
    expect(v.versions.map((x) => [x.version, x.remoteOnly])).toEqual([['3.0.0', false], ['3.1.0', false], ['3.2.0', false], ['3.3.0', true]]);
    expect(v.newSinceSeen).toEqual(['3.3.0']);
    expect(v.unpublished.map((c) => c.tickets)).toEqual([['PILOT-145']]);
    expect(v.branches).toMatchObject([{ branch: 'feature/PILOT-150-liveness', tickets: ['PILOT-150'] }]);
    expect(v.localVersion).toBe('3.2.0');
    rmSync(join(h.workflow, 'notes.txt'));
  });

  it('un commit local bloque l’avance ; une autre branche aussi', () => {
    gitIn(h.workflow, 'checkout', '-q', '-b', 'perso');
    expect(fetchAndUpdate(h.workflow).skipped).toBe('le clone est sur « perso », pas sur main');
    gitIn(h.workflow, 'checkout', '-q', 'main');
    writeFileSync(join(h.workflow, 'local.txt'), 'x');
    gitIn(h.workflow, 'add', 'local.txt');
    gitIn(h.workflow, 'commit', '-q', '-m', 'local');
    expect(fetchAndUpdate(h.workflow).skipped).toBe('1 commit local non poussé');
    gitIn(h.workflow, 'reset', '-q', '--hard', 'HEAD~1');
  });

  it('propre, sur main, sans commit local : avance rapide', () => {
    expect(fetchAndUpdate(h.workflow)).toEqual({ attempted: true, ok: true, updated: true });
    expect(versionsOf('p', h.workflow, DIR, null).localVersion).toBe('3.3.0');
    expect(fetchAndUpdate(h.workflow)).toEqual({ attempted: true, ok: true, updated: false });
  });

  it('un distant injoignable n’empêche pas de lire le local', () => {
    const h2 = makeWorkflowHistory(join(tmp, 'h2'));
    rmSync(h2.origin, { recursive: true, force: true });
    const f = fetchAndUpdate(h2.workflow);
    expect(f.ok).toBe(false);
    expect(f.error).toBeTruthy();
    expect(versionsOf('p', h2.workflow, DIR, null).versions).toHaveLength(3);
  });

  it('dépôt hors git, ou sans branche principale : pas de version, une raison', () => {
    const plain = mkdtempSync(join(tmpdir(), 'cc-nogit-'));
    expect(versionsOf('p', plain, DIR, null).error).toBe('dépôt workflow hors git : versions indisponibles');
    rmSync(plain, { recursive: true, force: true });
    const empty = join(tmp, 'empty');
    gitIn(tmp, 'init', '-q', '-b', 'main', empty);
    expect(versionsOf('p', empty, DIR, null).error).toBe('branche principale introuvable');
  });
});

describe('impacts', () => {
  const h = makeWorkflowHistory(join(tmp, 'h3'));
  const repos = resolveRepos({ CC_REPO_WORKFLOW: h.workflow, CC_REPO_FRONT: CORPUS.front, CC_REPO_E2E: CORPUS.e2e });
  const views = analyzeJourney(pilot, repos);
  const dataDir = join(tmp, 'data');

  it('sépare les tests touchés directement et via le sous-processus', () => {
    const r = impactsBetween(pilot, repos, views, '3.0.0', '3.2.0');
    const byName = (n: string) => r.tests.find((t) => t.test.id.endsWith(n));
    expect(byName('demande de pièces complémentaires')).toMatchObject({ suite: 'workflow', direct: ['email_advisor', 'more-documents'], via: [] });
    expect(byName('code faux')?.via).toContain('sig_blocked');
    expect(r.elements.find((e) => e.id === 'fraud-check')).toMatchObject({ kind: 'none', tests: [] });
  });

  it('bornes par défaut : de la version vue à la dernière', () => {
    expect(defaultRange(pilot, repos, dataDir)).toEqual({ from: '3.1.0', to: '3.2.0' });
    markSeen(dataDir, pilot.id, '3.0.0');
    expect(defaultRange(pilot, repos, dataDir)).toEqual({ from: '3.0.0', to: '3.2.0' });
    expect(allVersions([pilot], repos, dataDir, false).journeys[0]?.newSinceSeen).toEqual(['3.1.0', '3.2.0']);
  });
});

describe('utilitaires', () => {
  it('compare des versions et lit les tickets', () => {
    expect(['3.10.0', '3.2.0', '3.9.1'].sort(compareVersions)).toEqual(['3.2.0', '3.9.1', '3.10.0']);
    expect(ticketsIn('Fix [PILOT-12] et ABC-3, pas abc-4')).toEqual(['PILOT-12', 'ABC-3']);
  });
});

describe('withLayout', () => {
  it('ajoute une mise en page à un BPMN qui n’en a pas : chaque élément, sous-processus ouverts', async () => {
    const { withLayout } = await import('../src/engine/bpmnLayout');
    const { xml, generated } = withLayout(bpmnVersions().v320);
    expect(generated).toBe(true);
    const model = parseBpmn(xml);
    const shapes = [...xml.matchAll(/bpmnElement="([^"]+)"/g)].map((m) => m[1]);
    for (const e of model.elements) expect(shapes).toContain(e.id);
    expect(xml).toMatch(/bpmnElement="scan-id" isExpanded="true"/);
    // Le chemin principal reste sur une ligne : chaque session à droite de la précédente.
    const x = (id: string) => Number(new RegExp(`bpmnElement="${id}"[^>]*><dc:Bounds x="(\\d+)"`).exec(xml)![1]);
    expect(x('onboarding') < x('applicant') && x('scan-id') < x('documents') && x('documents') < x('review')).toBe(true);
  });

  it('laisse intact un BPMN qui a déjà sa mise en page', async () => {
    const { withLayout } = await import('../src/engine/bpmnLayout');
    const once = withLayout(bpmnVersions().v320).xml;
    expect(withLayout(once)).toEqual({ xml: once, generated: false });
  });
});
