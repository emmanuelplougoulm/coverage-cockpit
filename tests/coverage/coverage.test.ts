import { describe, expect, it } from 'vitest';
import { viewCells } from '../../src/core/coverage';
import { computeBpmn } from '../../src/engine/coverage/bpmnCoverage';
import { computeCoverage } from '../../src/engine/coverage';
import { attachTests, testLocales } from '../../src/engine/coverage/tests';
import type { BpmnModel } from '../../src/engine/parsers/bpmn';
import type { FrontModel } from '../../src/engine/parsers/front';
import { resolveRepos } from '../../src/engine/repos';
import { readBpmn, readFront, readTests } from '../../src/engine/sources';
import { pilot } from '../../src/journeys/pilot';
import { CORPUS } from '../corpus';
import { baseConfig, scanned } from './helpers';

const sig = (stepName: string) => [{ step: stepName, match: 'exact' as const, className: `step-${stepName}` }];
const front: FrontModel = {
  skeleton: false, groups: ['B_STEPS', 'C_STEPS'], locales: ['en', 'fr'], transitions: [], emails: [], texts: {}, warnings: [],
  states: [
    { group: 'B_STEPS', key: 'sign', kind: 'step', stepName: 'signature', locales: ['en', 'fr'] },
    { group: 'C_STEPS', key: 'countersign', kind: 'step', stepName: 'signature', locales: ['en', 'fr'] },
    { group: 'C_STEPS', key: 'summary', kind: 'step', stepName: 'summary', locales: ['en', 'fr'] },
  ],
};
const emptyBpmn: BpmnModel = { processId: 'j', elements: [], sessions: [], emails: [], decisions: [], branches: [] };
const view = (tests: ReturnType<typeof scanned>[], config = baseConfig) =>
  computeCoverage(config, 'ui', { bpmn: emptyBpmn, front, scan: { tests, files: [], readFiles: [], warnings: [] } });

describe('attachTests / testLocales', () => {
  it('garde les specs du parcours et les specs partagées qui appellent son configurateur', () => {
    const tests = [
      scanned('own'),
      scanned('shared ok', { file: 'tests/ui/shared/s.spec.ts', configurers: ['configureJ'] }),
      scanned('shared ko', { file: 'tests/ui/shared/s.spec.ts', configurers: ['configureOther'] }),
      scanned('wf', { file: 'tests/workflow/j/w.spec.ts' }),
      scanned('elsewhere', { file: 'tests/ui/other/x.spec.ts' }),
    ];
    const a = attachTests(tests, baseConfig, 'ui');
    expect(a.tests.map((t) => t.title)).toEqual(['own', 'shared ok']);
    expect(a.ignored.map((t) => t.id)).toEqual(['shared ko']);
    expect(attachTests(tests, baseConfig, 'workflow').tests.map((t) => t.title)).toEqual(['wf']);
  });

  it('prend la langue du cas, sinon le défaut, sinon inconnue', () => {
    expect(testLocales(scanned('a', { locales: ['en'] }), baseConfig)).toEqual(['en']);
    expect(testLocales(scanned('a', { locales: [] }), { ...baseConfig, defaultLocale: 'fr' })).toEqual(['fr']);
    expect(testLocales(scanned('a', { locales: [] }), baseConfig)).toBeNull();
    expect(testLocales(scanned('a', { locales: [], localeUnknown: true }), { ...baseConfig, defaultLocale: 'fr' })).toBeNull();
  });
});

describe('computeCoverage — écrans', () => {
  it('traversé sans capture, couvert avec capture, par langue', () => {
    const v = view([
      scanned('t1', { steps: sig('summary') }),
      scanned('t2', { locales: ['en'], steps: sig('summary'), screenshots: [{ call: 'validateUI', line: 2, page: sig('summary'), suffix: null, trail: [], name: null }] }),
    ]);
    const summary = v.sessions[1]!.states.find((s) => s.key === 'summary')!;
    expect(summary.byLocale.fr?.status).toBe('traversed');
    expect(summary.byLocale.en).toMatchObject({ status: 'covered', capturedBy: [{ id: 't2' }] });
  });

  it('laisse une page partagée ambiguë, comptée nulle part', () => {
    const v = view([scanned('t1', { steps: sig('signature'), screenshots: [{ call: 'validateUI', line: 2, page: sig('signature'), suffix: null, trail: [], name: null }] })]);
    // Le coup et la capture portent le même marqueur : une seule entrée.
    expect(v.ambiguous).toEqual([
      { marker: 'step-signature', candidates: ['B_STEPS.sign', 'C_STEPS.countersign'], tests: [{ id: 't1', file: 'tests/ui/j/a.spec.ts', line: 1 }] },
    ]);
    expect(Object.values(viewCells(v)).every((s) => s === 'missing')).toBe(true);
  });

  it('tranche une capture par la session de la page précédente', () => {
    const v = view([
      scanned('t1', {
        steps: [...sig('summary'), ...sig('signature')],
        screenshots: [{ call: 'validateUI', line: 2, page: sig('signature'), suffix: null, trail: [sig('summary')], name: null }],
      }),
    ]);
    expect(viewCells(v)['S|C_STEPS.countersign|fr']).toBe('covered');
  });

  it('range un test de langue inconnue à part, et retire les exclusions', () => {
    const v = view([scanned('t1', { locales: [], localeUnknown: true, steps: sig('summary') })], { ...baseConfig, excludedStates: ['C_STEPS.countersign'] });
    expect(v.unknownLocaleTests.map((t) => t.id)).toEqual(['t1']);
    expect(viewCells(v)['S|C_STEPS.summary|fr']).toBe('missing');
    expect(viewCells(v)['S|C_STEPS.countersign|fr']).toBeUndefined();
    expect(v.excluded).toContainEqual({ id: 'C_STEPS.countersign', reason: 'état hors périmètre (config)' });
  });

  it('signale un alias de config qui ne désigne rien', () => {
    expect(view([], { ...baseConfig, stepAliases: { 'step-x': 'Z_STEPS.nope' } }).warnings).toContain('config : step-x → Z_STEPS.nope ne désigne aucun état du front');
  });
});

describe('computeBpmn', () => {
  const sessions = view([scanned('t1', { steps: sig('summary') })]).sessions;
  const model: BpmnModel = {
    ...emptyBpmn,
    sessions: [
      { id: 'closing', workerTaskId: 'x', worker: 'client-session', sessionName: 'C_STEPS', statuses: [], exits: [], scope: [] },
      { id: 'dyn', workerTaskId: 'y', worker: 'client-session', sessionName: null, sessionNameExpression: '=x', statuses: [], exits: [], scope: [] },
      { id: 'gone', workerTaskId: 'z', worker: 'client-session', sessionName: 'B_STEPS', statuses: [], exits: [], scope: ['old'] },
    ],
    branches: [
      { key: 'r/a', flowId: 'a', gatewayId: 'g', isDefault: false, scope: ['r'] },
      { key: 'r/b', flowId: 'b', gatewayId: 'g', isDefault: false, scope: ['r'] },
      { key: 'r/c', flowId: 'c', gatewayId: 'g', isDefault: false, scope: ['r'] },
      { key: 'init/d', flowId: 'd', gatewayId: 'g2', isDefault: false, scope: ['init'] },
    ],
  };
  const config = { ...baseConfig, excludedBpmnSteps: ['old'], bpmnTechnicalSteps: ['init'], bpmnBranches: { 'r/a': ['C_STEPS.summary'], 'r/b': [] } };
  const els = computeBpmn(model, config, sessions, []);
  const status = (id: string) => els.find((e) => e.id === id)?.status;

  it('statut d’une session d’après ses états, unlinked si son nom est inconnu, exclue si son sous-processus l’est', () => {
    expect([status('closing'), status('dyn'), status('gone')]).toEqual(['traversed', 'unlinked', 'excluded']);
  });

  it('branche : preuve décidée, [] = exclue, rien = unlinked, technique = non listée', () => {
    expect([status('r/a'), status('r/b'), status('r/c'), status('init/d')]).toEqual(['traversed', 'excluded', 'unlinked', undefined]);
  });
});

describe('computeCoverage — pilote (corpus)', () => {
  const repos = resolveRepos({ CC_REPO_WORKFLOW: CORPUS.workflow, CC_REPO_FRONT: CORPUS.front, CC_REPO_E2E: CORPUS.e2e });
  const sources = { bpmn: readBpmn(pilot, repos), front: readFront(pilot, repos), scan: readTests(pilot, repos) };
  const ui = computeCoverage(pilot, 'ui', sources);
  const wf = computeCoverage(pilot, 'workflow', sources);
  const ui$ = viewCells(ui);
  const wf$ = viewCells(wf);

  it('tranche la page de signature par le chemin nominal du test', () => {
    expect(ui$['S|SIGNATURE_STEPS.sign|fr']).toBe('covered');
    expect(ui$['S|CLOSING_STEPS.countersign|fr']).toBe('missing');
    expect(ui.ambiguous).toEqual([]);
  });

  it('couvre le message nommé par le suffixe, la page n’étant que traversée', () => {
    expect(ui$['S|SIGNATURE_STEPS.helperTextOnError|fr']).toBe('covered');
    expect(ui$['S|SIGNATURE_STEPS.otp|fr']).toBe('traversed');
  });

  it('ne compte pas la sonde, compte le marqueur et la classe SDK', () => {
    const summary = ui.sessions.find((s) => s.group === 'CLOSING_STEPS')!.states.find((s) => s.key === 'summary')!;
    expect(summary.byLocale.fr?.tests.map((t) => t.id)).not.toContain('Erreurs de signature @SAD_PATH @PILOT-TC-TODO › code faux');
    expect(ui$['S|APPLICANT_STEPS.deleteDialog|en']).toBe('traversed');
    expect(ui$['S|JOURNEY.internalError|en']).toBe('covered');
  });

  it('écarte la spec partagée d’un autre parcours et range la langue illisible à part', () => {
    expect(ui.testsScanned).toBe(8);
    expect(ui.excluded).toContainEqual({ id: 'Post-déploiement › smoke prêt', reason: 'spec partagée sans configurateur du parcours' });
    expect(ui.unknownLocaleTests.map((t) => t.id)).toEqual(["Pièce d'identité v2 › langue illisible"]);
  });

  it('suite workflow : e-mails par objet normalisé, gamme, langue fixe, branches prouvées', () => {
    expect(wf$['E|application-rejected|REJ01|fr']).toBe('covered');
    expect(wf$['E|welcome|premium/default|fr']).toBe('traversed');
    expect(wf$['E|advisor-notification|default|fr']).toBe('traversed');
    expect(wf$['B|review/rejected']).toBe('covered');
    expect(wf$['B|review/more-documents']).toBe('traversed');
    expect(wf$['B|review/approved']).toBe('unlinked');
    expect(wf$['B|review/fraud-check']).toBe('excluded');
    expect(wf.unattributed).toEqual([]);
  });

  it('sessions BPMN : bpmnSessions pour le nom variable, e-mail par minuterie exclu', () => {
    expect(ui.bpmn.find((b) => b.id === 'documents')).toMatchObject({ status: 'missing', source: 'config' });
    expect(ui$['B|email_documents_reminder']).toBe('excluded');
    expect(ui.orphanTemplates).toEqual(['legacy-newsletter']);
  });
});
