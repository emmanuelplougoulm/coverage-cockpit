import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { caseKeyOf, parseCaseDraft } from '../src/core/cases';
import { branchChoice, ownGitRoot, prepareBranch } from '../src/engine/agents/branch';
import { cliArgs, disallowedTools, guardrailPrompt, modelFor } from '../src/engine/agents/guardrails';
import { getRun, replyRun, startRun } from '../src/engine/agents';
import { RunStore, spendOf, type Launcher } from '../src/engine/agents/runs';
import { parseStream, questionsOf } from '../src/engine/agents/stream';
import { analyzeJourney } from '../src/engine/analyze';
import { applyCaptures, hunksOf, planCaptures } from '../src/engine/captures';
import { FakeCaseClient } from '../src/engine/cases/client';
import { pushCase, readLinks, writeKey } from '../src/engine/cases';
import { loadKnowledge } from '../src/engine/knowledge/load';
import { onboard, survey } from '../src/engine/onboard';
import { readFront, readTests } from '../src/engine/sources';
import { resolveRepos } from '../src/engine/repos';
import { pilot } from '../src/journeys/pilot';
import { CORPUS } from './corpus';

const tmp = mkdtempSync(join(tmpdir(), 'cc-agents-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const FAKE = fileURLToPath(new URL('../fixtures/corpus/tools/fake-agent.mjs', import.meta.url));
const KNOWLEDGE = fileURLToPath(new URL('../knowledge', import.meta.url));
const repos = resolveRepos({ CC_REPO_WORKFLOW: CORPUS.workflow, CC_REPO_FRONT: CORPUS.front, CC_REPO_E2E: CORPUS.e2e });
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env: gitEnv, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
function gitCopyOfCorpusE2e(name: string): string {
  const dir = join(tmp, name);
  cpSync(CORPUS.e2e, dir, { recursive: true });
  g(tmp, 'init', '-q', '-b', 'main', dir);
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
const line = (o: object) => JSON.stringify(o) + '\n';

describe('flux stream-json', () => {
  it('lit session, modèle, messages, outils et résultat ; ignore une ligne tronquée', () => {
    const p = parseStream(
      line({ type: 'system', subtype: 'init', session_id: 's1', model: 'm' }) +
        line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }, { type: 'text', text: 'Bonjour' }] } }) +
        line({ type: 'result', subtype: 'success', is_error: false, result: 'Fin', total_cost_usd: 0.12 }) +
        '{"type":"assis',
    );
    expect(p).toEqual({ sessionId: 's1', model: 'm', messages: ['Bonjour'], tools: ['Read'], result: { text: 'Fin', cost: 0.12, isError: false, subtype: 'success' } });
  });

  it('extrait les questions (bloc QUESTIONS ou lignes en « ? »)', () => {
    expect(questionsOf('Texte.\n\nQUESTIONS :\n- On couvre l’anglais ?\n- Branche de campagne ?')).toEqual(['On couvre l’anglais ?', 'Branche de campagne ?']);
    expect(questionsOf('Pas de question.')).toEqual([]);
  });
});

describe('RunStore (lanceur simulé)', () => {
  const dir = join(tmp, 'data-sim');
  /** Lanceur qui écrit tout de suite le flux d'un tour terminé. */
  const sim = (cost: number, exit = 0, alive = false): Launcher => ({ out, err, exit: ex }) => {
    writeFileSync(out, line({ type: 'system', subtype: 'init', session_id: 'sess' }) + line({ type: 'result', subtype: exit ? 'error' : 'success', is_error: !!exit, result: 'ok ?', total_cost_usd: cost }));
    writeFileSync(err, exit ? 'boum' : '');
    if (!alive) writeFileSync(ex, `${exit}\n`);
    return alive ? process.pid : 999_999;
  };

  it('coût cumulatif : le coût d’un tour est la différence ; questions ; reprise du même modèle', () => {
    const st = new RunStore(dir, sim(0.1));
    const s = st.create({ kind: 'request', journey: 'j', title: 't', model: 'modele-epingle', cwd: tmp });
    st.startTurn(s, 'p1', () => [], ['x']);
    const after1 = st.get('request', s.id);
    expect(after1).toMatchObject({ status: 'waiting', sessionId: 'sess', totalCost: 0.1, questions: ['ok ?'] });
    const st2 = new RunStore(dir, sim(0.25));
    const seen: string[][] = [];
    st2.startTurn(after1, 'p2', (sid) => (seen.push(['--resume', sid ?? '', '--model', after1.model]), []), ['x']);
    expect(seen).toEqual([['--resume', 'sess', '--model', 'modele-epingle']]);
    const after2 = st2.get('request', s.id);
    expect(after2.turns.map((t) => t.costDelta)).toEqual([0.1, 0.15]);
    expect(after2.totalCost).toBe(0.25);
    expect(spendOf([after2]).byKind).toEqual({ request: 0.25 });
  });

  it('échec : code ≠ 0 + stderr ; processus disparu sans code : échec', () => {
    const st = new RunStore(dir, sim(0.01, 3));
    const s = st.startTurn(st.create({ kind: 'request', journey: null, title: 't', model: 'm', cwd: tmp }), 'p', () => [], ['x']);
    expect(st.get('request', s.id)).toMatchObject({ status: 'failed' });
    expect(st.get('request', s.id).turns[0]!.error).toBe('boum');
    const lost = new RunStore(dir, () => 999_999); // aucun fichier, pid mort
    const l = lost.startTurn(lost.create({ kind: 'request', journey: null, title: 't', model: 'm', cwd: tmp }), 'p', () => [], ['x']);
    expect(lost.get('request', l.id).turns[0]!.error).toBe('processus disparu sans code de sortie');
  });

  it('arrêt, clôture, refus d’un second tour pendant un tour', () => {
    const st = new RunStore(dir, sim(0, 0, true));
    const s = st.startTurn(st.create({ kind: 'request', journey: null, title: 't', model: 'm', cwd: tmp }), 'p', () => [], ['x']);
    expect(() => st.startTurn(s, 'p2', () => [], ['x'])).toThrow(/tourne déjà/);
    const stopped = st.stop({ ...s, pid: null });
    expect(stopped.status).toBe('stopped');
    expect(st.setStatus(stopped, 'closed').status).toBe('closed');
  });
});

describe('run détaché réel (faux agent du corpus)', () => {
  const env = { CC_AGENT_CMD: `node ${FAKE}`, CC_NOTIFY: 'off' };
  const a = { repos, dataDir: join(tmp, 'data-real'), toolRoot: tmp, env };
  const until = async (id: string) => {
    for (let i = 0; i < 60; i++) {
      const s = getRun(a, id);
      if (s.status !== 'running') return s;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('délai dépassé');
  };

  it('conception puis code : même session, même modèle, coût cumulé ; le corpus n’autorise aucun commit', async () => {
    const s = startRun(a, 'generation', pilot, 'Couvrir le blocage de la pièce');
    expect(s).toMatchObject({ status: 'running', model: 'claude-sonnet-5-5', phase: 'design', branch: null });
    expect(s.notes[0]).toMatch(/autre dépôt git.*aucun commit/);
    const d = await until(s.id);
    expect(d).toMatchObject({ status: 'waiting', totalCost: 0.08 });
    expect(d.questions).toHaveLength(2);
    replyRun(a, s.id, 'Oui', 'code');
    const c = await until(s.id);
    expect(c).toMatchObject({ status: 'waiting', phase: 'code', sessionId: d.sessionId, model: 'claude-sonnet-5-5', totalCost: 0.42 });
    expect(readFileSync(join(a.dataDir, 'runs/generations', s.id, 'turn-2.prompt.txt'), 'utf8')).toMatch(/Phase CODE[\s\S]*Ne pousse jamais/);
  }, 20_000);

  it('l’onboarding prend le modèle le plus puissant', () => {
    expect(modelFor('onboarding', {})).toBe('claude-opus-5-5');
    expect(modelFor('generation', { CC_AGENT_MODEL: 'autre' })).toBe('autre');
  });
});

describe('garde-fous', () => {
  it('refuse push, principale, secrets, images, écriture front et workflow', () => {
    const d = disallowedTools(repos);
    for (const x of ['Bash(git push:*)', 'Bash(git switch main*)', 'Read(**/.env*)', 'Read(**/*.png)', `Edit(${repos.front.path}/**)`, `Write(${repos.workflow.path}/**)`]) expect(d).toContain(x);
  });

  it('une demande est en lecture seule ; le modèle est épinglé à la reprise', () => {
    const args = cliArgs({ prompt: 'p', model: 'M', sessionId: 'S', kind: 'request', repos, system: guardrailPrompt('request', { branch: null, e2e: 'e', front: 'f', workflow: 'w', notes: [] }) });
    const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
    expect(allowed).toEqual(['Read', 'Grep', 'Glob']);
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4)).toEqual(['--model', 'M', '--resume', 'S']);
    expect(args[args.indexOf('--append-system-prompt') + 1]).toMatch(/lecture seule/);
  });
});

describe('choix et préparation de branche', () => {
  it('le corpus (sous-dossier d’un autre dépôt) : ni branche ni commit', () => {
    expect(ownGitRoot(CORPUS.e2e)).toBeNull();
    expect(branchChoice(CORPUS.e2e, 'j', 'generation', null).isGit).toBe(false);
  });

  it('principale propre : on ne reste pas, on coupe une branche ; sale : refus', () => {
    const repo = gitCopyOfCorpusE2e('br1');
    const c = branchChoice(repo, 'pilot', 'generation', 'PILOT-501');
    expect(c).toMatchObject({ isGit: true, current: { branch: 'main', canStay: false, dirty: false }, proposed: { name: 'PILOT-501' } });
    expect(prepareBranch(repo, c, { stay: false })).toEqual({ branch: 'PILOT-501', notes: [] });
    expect(g(repo, 'symbolic-ref', '--short', 'HEAD')).toBe('PILOT-501');
    g(repo, 'switch', '-q', 'main');
    writeFileSync(join(repo, 'brouillon.txt'), 'x');
    expect(() => prepareBranch(repo, branchChoice(repo, 'pilot', 'generation', null), { stay: false })).toThrow(/non commitées sur branche principale/);
    expect(() => prepareBranch(repo, c, { stay: false, name: 'main' })).toThrow();
  });

  it('branche de travail sale : on reste, et l’agent est prévenu', () => {
    const repo = gitCopyOfCorpusE2e('br2');
    g(repo, 'switch', '-q', '-c', 'perso');
    writeFileSync(join(repo, 'brouillon.txt'), 'x');
    const r = prepareBranch(repo, branchChoice(repo, 'pilot', 'generation', null), { stay: false });
    expect(r.branch).toBe('perso');
    expect(r.notes[0]).toMatch(/modifications non commitées de l'utilisateur/);
  });
});

describe('gains rapides sans IA', () => {
  const knowledge = loadKnowledge(KNOWLEDGE);
  const views = analyzeJourney(pilot, repos, undefined, knowledge);
  const plan = planCaptures(pilot, views.ui, readTests(pilot, repos), readFront(pilot, repos));

  it('place les captures possibles et explique les autres', () => {
    expect(plan.insertions.map((i) => [i.file.split('/').at(-1), i.line, i.text.trim()])).toEqual([
      ['applicant.spec.ts', 10, 'await identity.validateUI();'],
      ['nominal.spec.ts', 32, 'await otp.validateUI();'],
      ['signature-errors.spec.ts', 14, 'await otp.validateUI();'],
    ]);
    expect(plan.unplaced.map((u) => u.reason.split(' ')[0])).toContain('IdCapturePage');
    expect(hunksOf(CORPUS.e2e, plan.insertions)[1]!.lines.filter((l) => l.kind === 'added').map((l) => l.line)).toEqual([32]);
  });

  it('refuse d’écrire dans le corpus ; commit local sur une nouvelle branche dans un vrai dépôt', () => {
    expect(() => applyCaptures(repos, plan)).toThrow(/propre dépôt git/);
    const repo = gitCopyOfCorpusE2e('cap');
    const r = applyCaptures({ ...repos, e2e: { ...repos.e2e, path: repo } }, plan, new Date('2026-11-24T10:00:00Z'));
    expect(r.branch).toBe('cc/captures-pilot-account-opening-202611241000');
    expect(readFileSync(join(repo, 'tests/ui/pilot-account-opening/nominal.spec.ts'), 'utf8').split('\n')[31]).toBe('      await otp.validateUI();');
    expect(g(repo, 'status', '--porcelain')).toBe('');
    expect(g(repo, 'log', '--oneline', '-1')).toMatch(/gains rapides/);
  });
});

describe('cas de test', () => {
  it('clé la plus proche, brouillon JSON', () => {
    expect(caseKeyOf(['@HAPPY', '@P-TC-TODO', '@P-TC-31'])).toBe('P-TC-31');
    expect(caseKeyOf(['@P-TC-TODO'])).toBe('TODO');
    expect(parseCaseDraft('x\n```json\n{"title":"T","steps":[{"action":"a"}]}\n```')).toEqual({ title: 'T', description: '', preconditions: '', steps: [{ action: 'a', data: '', expected: '', rendering: '' }] });
    expect(parseCaseDraft('pas de json')).toBeNull();
  });

  it('faux outil : création, pièce jointe, états groupés, exigence, 404', async () => {
    const c = new FakeCaseClient(join(tmp, 'cases.json'));
    const key = await c.createCase('CLIENT / n. j / Passants', { title: 'T', description: '', preconditions: '', steps: [] }, ['@HAPPY_PATH']);
    expect(key).toBe('PILOT-TC-100');
    await c.setStatus([key], 'Automatisé');
    await c.linkRequirement(key, 'PILOT-150');
    expect(await c.getCase(key)).toMatchObject({ status: 'Automatisé', requirements: ['PILOT-150'] });
    await expect(c.attach('PILOT-TC-999', 0, FAKE)).rejects.toThrow(/404/);
  });

  it('création sur clic : captures jointes, pas de double création ; clé écrite sur la ligne du test', async () => {
    const dataDir = join(tmp, 'cases-data');
    mkdirSync(dataDir, { recursive: true });
    process.env.CC_CASES_FAKE = '1';
    const views = analyzeJourney(pilot, repos);
    const test = 'Ouverture en ligne @HAPPY_PATH › chemin nominal en ligne fr';
    const draft = '```json\n{"title":"T","steps":[{"action":"a","rendering":"welcome"},{"action":"b","rendering":"summary"}]}\n```';
    const r = await pushCase(dataDir, repos, views.ui, test, draft);
    expect(r).toMatchObject({ key: 'PILOT-TC-100', attachments: 2 });
    await expect(pushCase(dataDir, repos, views.ui, test, draft)).rejects.toThrow(/déjà lié/);
    expect(readLinks(dataDir)[test]?.key).toBe('PILOT-TC-100');
    delete process.env.CC_CASES_FAKE;

    const repo = gitCopyOfCorpusE2e('key');
    g(repo, 'switch', '-q', '-c', 'PILOT-501');
    const k = writeKey({ ...repos, e2e: { ...repos.e2e, path: repo } }, 'tests/ui/pilot-account-opening/signature-errors.spec.ts', 9, 'PILOT-TC-100', true);
    expect(k.after).toBe("  test('code faux @PILOT-TC-100', async ({ page, request }) => {");
    expect(k.committed).toBeTruthy();
    expect(readFileSync(join(repo, 'tests/ui/pilot-account-opening/signature-errors.spec.ts'), 'utf8')).toContain('@SAD_PATH @PILOT-TC-TODO'); // le describe n'est pas touché
  });
});

describe('onboarding', () => {
  it('rapport : points à trancher du pilote ; survey', () => {
    const r = onboard('pilot-account-opening', repos, pilot, loadKnowledge(KNOWLEDGE));
    expect(r.points.some((p) => p.includes('review/approved'))).toBe(true);
    expect(r.report).toContain('## Propositions');
    expect(r.draft).toContain('export const draft: JourneyConfig');
    expect(survey(repos, [pilot])).toEqual([{ process: 'pilot-account-opening', file: 'processes/pilot-account-opening/pilot-account-opening.bpmn', configured: true }]);
    expect(() => onboard('inconnu', repos, undefined, loadKnowledge(KNOWLEDGE))).toThrow(/introuvable/);
    expect(existsSync(CORPUS.e2e)).toBe(true);
  });
});
