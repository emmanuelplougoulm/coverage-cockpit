import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeJourney } from '../src/engine/analyze';
import { applyCatalog, assignBricks } from '../src/engine/knowledge/apply';
import { auditAssertions } from '../src/engine/knowledge/audit';
import { KnowledgeError, loadKnowledge, parseDecisions, parsePatterns, parseBricks } from '../src/engine/knowledge/load';
import { readBpmn, readFront } from '../src/engine/sources';
import { resolveRepos } from '../src/engine/repos';
import { pilot } from '../src/journeys/pilot';
import { CORPUS } from './corpus';

const KNOWLEDGE = fileURLToPath(new URL('../knowledge', import.meta.url));
const knowledge = loadKnowledge(KNOWLEDGE);
const repos = resolveRepos({ CC_REPO_WORKFLOW: CORPUS.workflow, CC_REPO_FRONT: CORPUS.front, CC_REPO_E2E: CORPUS.e2e });

describe('chargement de la connaissance', () => {
  it('charge et valide les quatre fichiers du dépôt', () => {
    expect(knowledge.decisions.map((d) => d.id)).toContain('approved-continues');
    expect(knowledge.expectations.length).toBeGreaterThan(0);
  });

  it('refuse une décision sans raison, un genre inconnu, une regex invalide, des liens mal formés', () => {
    expect(() => parseDecisions('- { id: a, kind: branch, event: x, links: none }')).toThrow(/why/);
    expect(() => parseDecisions('- { id: a, kind: other, why: w }')).toThrow(/genre inconnu/);
    expect(() => parseDecisions("- { id: a, kind: excludeState, why: w, pattern: '(' }")).toThrow(/regex invalide/);
    expect(() => parseDecisions('- { id: a, kind: branch, why: w, event: x, links: foo }')).toThrow(/links/);
    expect(() => parseDecisions('- { id: a, kind: excludeState, why: w, pattern: x }\n- { id: a, kind: excludeState, why: w, pattern: y }')).toThrow(/double/);
  });

  it('refuse une brique ou une couche inconnues', () => {
    const bricks = parseBricks('bricks: [{ id: a, label: A }]');
    expect(() => parseBricks('bricks: [{ id: a, label: A }]\nfront: [{ match: x, brick: b, confidence: haute }]')).toThrow(KnowledgeError);
    expect(() => parsePatterns('patterns: { a: { intentions: [{ id: i, label: I, layer: Ailleurs }] } }', bricks)).toThrow(/couche/);
  });

  it('un dossier vide vaut une connaissance vide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-k-'));
    expect(loadKnowledge(dir)).toEqual({ decisions: [], bricks: { bricks: [], front: [], states: [], subprocesses: [] }, patterns: {}, expectations: [] });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('applyCatalog', () => {
  const bpmn = readBpmn(pilot, repos);
  const front = readFront(pilot, repos);

  it('ne touche jamais ce que la config décide, laisse « à trancher » un lien ambigu', () => {
    const { config, outcome } = applyCatalog(pilot, knowledge.decisions, bpmn, front);
    expect(config.bpmnBranches!['review/rejected']).toEqual(pilot.bpmnBranches!['review/rejected']);
    expect(config.bpmnBranchSources!['review/rejected']).toBe('config');
    expect(outcome.pending).toMatchObject([{ decision: 'approved-continues', target: 'review/approved' }]);
    expect(outcome.pending[0]!.candidates.length).toBeGreaterThan(1);
    expect(config.excludedEmailTemplates).toContain('legacy-newsletter');
  });

  it('applique un lien qui désigne exactement un élément, et respecte les exceptions', () => {
    const { bpmnBranches: _b, ...bare } = pilot;
    const r = applyCatalog({ ...bare, bpmnBranches: {} }, knowledge.decisions, bpmn, front);
    expect(r.config.bpmnBranches!['review/rejected']).toEqual(['email:application-rejected']);
    expect(r.config.bpmnBranchSources!['review/rejected']).toBe('catalogue rejection-email');
    expect(r.config.bpmnBranches!['review/fraud-check']).toEqual([]);
    const withException = knowledge.decisions.map((d) => (d.id === 'rejection-email' ? { ...d, exceptions: [pilot.id] } : d));
    expect(applyCatalog({ ...bare, bpmnBranches: {} }, withException, bpmn, front).config.bpmnBranches!['review/rejected']).toBeUndefined();
  });

  it('ne fait rien sans catalog: true', () => {
    const { config, outcome } = applyCatalog({ ...pilot, catalog: false }, knowledge.decisions, bpmn, front);
    expect(config).toEqual({ ...pilot, catalog: false });
    expect(outcome).toEqual({ applied: [], pending: [] });
  });
});

describe('assignBricks', () => {
  it('état, puis groupe, puis sous-processus (ou sa session) ; sinon à classer', () => {
    const a = assignBricks(knowledge.bricks, ['SIGNATURE_STEPS', 'MYSTERY_STEPS'], ['CLOSING_STEPS.countersign'], [{ id: 'review' }, { id: 'signature', groups: ['SIGNATURE_STEPS'] }, { id: 'odd' }]);
    expect(a.map((x) => [x.ref, x.brick])).toEqual([
      ['SIGNATURE_STEPS', 'signature'],
      ['MYSTERY_STEPS', null],
      ['CLOSING_STEPS.countersign', 'signature'],
      ['bpmn:review', 'decision'],
      ['bpmn:signature', 'signature'],
      ['bpmn:odd', null],
    ]);
  });
});

describe('auditAssertions (pilote, suite workflow)', () => {
  const views = analyzeJourney(pilot, repos, undefined, knowledge);
  const audit = auditAssertions(views.workflow, knowledge);
  const fact = (id: string) => audit.facts.find((f) => f.id === id)!;

  it('sépare contrôles et gardes, et classe chaque contrôle', () => {
    expect(audit.guards).toBe(1);
    expect(audit.controls.find((c) => c.check === 'checkCaseStatus')).toMatchObject({ layer: 'API', intentions: ['identity-status', 'case-status'], strength: 'valeur' });
    expect(audit.controls.find((c) => c.check === 'checkSignedDocument')?.strength).toBe('presence');
  });

  it('fait du BPMN : contrôlé, seulement atteint, manquant, hors total', () => {
    expect(fact('review/rejected')).toMatchObject({ status: 'controlled', brick: 'decision' });
    expect(fact('email_advisor')).toMatchObject({ status: 'reached', missingIntentions: ['email-content'] });
    expect(fact('email_advisor').traversedOnly).toEqual(['Back-office › demande de pièces complémentaires']);
    expect(fact('signature').status).toBe('missing');
    expect(fact('review/fraud-check').status).toBe('excluded');
    expect(fact('email_documents_reminder')).toMatchObject({ status: 'excluded', missingIntentions: [] });
    expect(fact('review/approved').status).toBe('unlinked');
    expect(fact('onboarding').status).toBe('controlled'); // aucune attente : l'atteindre suffit
  });

  it('taux contrôlé : majorant, hors exclus et sans lien', () => {
    expect(audit.rate).toEqual({ controlled: 5, reached: 6, total: 12 });
  });
});

describe('fixture du catalogue inchangée par une décision écrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-kw-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('un fichier écrit à la main se relit', () => {
    writeFileSync(join(dir, 'decisions.yaml'), "- { id: x, kind: technicalStep, pattern: '^init', why: sans écran }\n");
    expect(loadKnowledge(dir).decisions).toEqual([{ id: 'x', kind: 'technicalStep', pattern: '^init', why: 'sans écran', journeys: [], exceptions: [] }]);
  });
});
