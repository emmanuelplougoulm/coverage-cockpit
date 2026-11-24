import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { familiesOf, familyOfState, isNominalTest, scenarioRequest, smokeOf, smokeRequest, tagIssues } from '../src/core/families';
import { analyzeJourney } from '../src/engine/analyze';
import { resolveNominal, walkSession } from '../src/engine/coverage/nominal';
import { readBpmn, readFront, readTests } from '../src/engine/sources';
import { resolveRepos } from '../src/engine/repos';
import { readAside, readSmokeValidations, setAside, setSmokeValidation } from '../src/engine/store/decisions';
import { pilot } from '../src/journeys/pilot';
import { CORPUS } from './corpus';

const repos = resolveRepos({ CC_REPO_WORKFLOW: CORPUS.workflow, CC_REPO_FRONT: CORPUS.front, CC_REPO_E2E: CORPUS.e2e });
const views = analyzeJourney(pilot, repos);
const reg = familiesOf(views.ui, {}, views.workflow);
const byId = (id: string) => reg.scenarios.find((s) => s.id === id)!;

describe('familiesOf — pilote', () => {
  it('range les scénarios en cinq familles', () => {
    expect(Object.fromEntries(Object.entries(reg.counts).map(([f, c]) => [f, c.scenarios]))).toEqual({
      nominal: 2, escalation: 2, alternative: 4, email: 4, technical: 2,
    });
  });

  it('un scénario nominal par canal, dans l’ordre du chemin', () => {
    expect(byId('nominal:online').steps.map((s) => s.ref)).toEqual(pilot.nominalPaths![0]!.screens);
    expect(byId('nominal:online')).toMatchObject({ done: 6, total: 20, state: 'partial' });
  });

  it('garde message, nouvel essai et écran de fin ensemble, dans cet ordre', () => {
    expect(byId('escalation:SCAN_ID_STEPS').steps.map((s) => s.label)).toEqual(['blockedError', 'retry', 'blocked']);
    expect(byId('escalation:SIGNATURE_STEPS').steps.map((s) => s.label)).toEqual(['helperTextOnError', 'codeHelperTextOnError', 'noMoreAttempts']);
  });

  it('erreurs techniques : une ligne par texte, une capture suffit', () => {
    const t = byId('technical:JOURNEY.internalError');
    expect(t).toMatchObject({ anyOf: true, done: 1, total: 2, label: '« Une erreur est survenue. Réessayez plus tard. »' });
  });

  it('e-mails : un e-mail capturé par un test workflow compte dans le registre', () => {
    expect(byId('email:application-rejected')).toMatchObject({ done: 1, state: 'partial' });
  });

  it('un écran écarté sort du compte ; un scénario tout écarté passe « écarté »', () => {
    const r = familiesOf(views.ui, { 'SCAN_ID_STEPS.captureHelp': { reason: 'hérité', at: 't' }, 'SCAN_ID_STEPS.retry': { reason: 'x', at: 't' } }, views.workflow);
    expect(r.scenarios.find((s) => s.id === 'alternative:SCAN_ID_STEPS.captureHelp')?.state).toBe('aside');
    expect(r.scenarios.find((s) => s.id === 'escalation:SCAN_ID_STEPS')?.total).toBe(4);
  });

  it('signale un chemin nominal inconnu', () => {
    const none = familiesOf({ ...views.ui, nominal: { source: null, confidence: null, paths: [] } });
    expect(none.nominalUnknown).toBe(true);
    expect(none.counts.nominal.scenarios).toBe(0);
  });
});

describe('familyOfState', () => {
  const nominal = new Set(['A.sign']);
  it('applique les règles dans l’ordre : fin d’escalade, nominal, technique, escalade, alternative', () => {
    expect(familyOfState('A.internalErrorEnd', nominal, ['A.internalErrorEnd'])).toBe('escalation');
    expect(familyOfState('A.sign', nominal)).toBe('nominal');
    expect(familyOfState('JOURNEY.anything', nominal)).toBe('technical');
    expect(familyOfState('A.serverErrorTimeout', nominal)).toBe('technical');
    expect(familyOfState('A.retry', nominal)).toBe('escalation');
    expect(familyOfState('A.lockedError', nominal)).toBe('alternative');
  });
});

describe('tags et smoke', () => {
  it('le tag le plus proche l’emporte', () => {
    expect(isNominalTest(['@HAPPY_PATH'])).toBe(true);
    expect(isNominalTest(['@HAPPY_PATH', '@SAD_PATH'])).toBe(false);
    expect(isNominalTest(['@SAD_PATH', '@HAPPY_PATH'])).toBe(true);
    expect(isNominalTest(['@P1'])).toBe(false);
  });

  it('smoke par canal et par langue ; la validation tient tant que c’est le même test', () => {
    const fr = 'Ouverture en ligne @HAPPY_PATH › chemin nominal en ligne fr';
    const s = smokeOf(views.ui, { 'online|fr': fr, 'online|en': 'un autre test' });
    expect(s.map((c) => [c.pathId, c.locale, c.status, c.validated])).toEqual([
      ['online', 'fr', 'partial', true],
      ['online', 'en', 'partial', false],
      ['branch', 'fr', 'todo', false],
      ['branch', 'en', 'todo', false],
    ]);
    expect(s[1]?.staleValidation).toBe('un autre test');
  });

  it('signale un test qui suit un chemin sans @HAPPY_PATH', () => {
    const tags = { ...views.ui.testTags };
    for (const k of Object.keys(tags)) if (k.includes('en ligne fr')) tags[k] = ['@PILOT-TC-12'];
    const issues = tagIssues({ ...views.ui, testTags: tags });
    expect(issues.map((i) => i.test.id)).toEqual(['Ouverture en ligne @HAPPY_PATH › chemin nominal en ligne fr']);
    expect(tagIssues(views.ui)).toEqual([]);
  });
});

describe('demandes', () => {
  it('rédige la demande d’un scénario', () => {
    const text = scenarioRequest(byId('technical:JOURNEY.serverErrorTimeout'), { id: pilot.id, label: pilot.label });
    expect(text).toContain('Nouveau test — Erreurs techniques');
    expect(text).toContain('jamais page.route');
    expect(scenarioRequest(byId('nominal:online'), { id: pilot.id, label: pilot.label })).toMatch(/^Compléter[\s\S]*À capturer en fr : ONBOARDING_STEPS.channel[\s\S]*Taguer le test @HAPPY_PATH/);
    expect(smokeRequest({ id: 'x', label: 'X' }, ['fr'])).toContain('Chemin nominal inconnu');
  });
});

describe('resolveNominal', () => {
  const front = readFront(pilot, repos);
  const bpmn = readBpmn(pilot, repos);
  const scan = readTests(pilot, repos);
  const { nominalPaths: _ignored, ...noPaths } = pilot;

  it('suit la première sortie de chaque carte sans quitter la session', () => {
    expect(walkSession('SIGNATURE_STEPS', front, new Set())).toEqual(['SIGNATURE_STEPS.sign', 'SIGNATURE_STEPS.otp']);
    expect(walkSession('ONBOARDING_STEPS', front, new Set())).toEqual(['ONBOARDING_STEPS.welcome', 'ONBOARDING_STEPS.channel']);
  });

  it('config d’abord, puis test workflow @P1, puis proposition BPMN', () => {
    expect(resolveNominal(pilot, front, scan, bpmn).source).toBe('config');
    const p1 = resolveNominal(noPaths, front, scan, bpmn);
    expect(p1).toMatchObject({ source: 'p1', confidence: 'moyenne', evidence: 'tests/workflow/pilot-account-opening/p1.spec.ts:11' });
    expect(p1.paths[0]?.screens).toEqual(['ONBOARDING_STEPS.welcome', 'ONBOARDING_STEPS.channel']);
    const proposal = resolveNominal(noPaths, front, { ...scan, tests: scan.tests.filter((t) => !t.tags.includes('@P1')) }, bpmn);
    expect(proposal.source).toBe('bpmn');
    expect(proposal.paths[0]?.screens[0]).toBe('ONBOARDING_STEPS.welcome');
    expect(proposal.paths[0]?.screens).toContain('DOCUMENTS_STEPS.upload');
  });
});

describe('décisions locales', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-dec-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('écarte avec raison, réintègre, refuse sans raison ou mal formé', () => {
    expect(setAside(dir, 'j', 'A_STEPS.x', 'hérité', new Date('2026-11-24T10:00:00Z'))).toEqual({ 'A_STEPS.x': { reason: 'hérité', at: '2026-11-24T10:00:00.000Z' } });
    expect(() => setAside(dir, 'j', 'A_STEPS.y', '  ')).toThrow(/raison/);
    expect(() => setAside(dir, 'j', 'pas un écran', 'x')).toThrow(/mal formé/);
    setAside(dir, 'j', 'A_STEPS.x', null);
    expect(readAside(dir, 'j')).toEqual({});
  });

  it('valide et retire un smoke', () => {
    setSmokeValidation(dir, 'j', 'online|fr', 'T');
    expect(readSmokeValidations(dir, 'j')).toEqual({ 'online|fr': 'T' });
    setSmokeValidation(dir, 'j', 'online|fr', null);
    expect(readSmokeValidations(dir, 'j')).toEqual({});
    expect(() => setSmokeValidation(dir, 'j', 'online', 'T')).toThrow(/mal formée/);
  });
});
