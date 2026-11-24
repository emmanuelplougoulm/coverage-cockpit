import { describe, expect, it } from 'vitest';
import { resolveRepos } from '../src/engine/repos';
import { readBpmn, readFront, readTests, SourceError } from '../src/engine/sources';
import { pilot } from '../src/journeys/pilot';
import { CORPUS } from './corpus';

const repos = resolveRepos({ CC_REPO_WORKFLOW: CORPUS.workflow, CC_REPO_FRONT: CORPUS.front, CC_REPO_E2E: CORPUS.e2e });
const absent = resolveRepos({}, '/nonexistent-cc-home');

describe('sources du parcours pilote (corpus)', () => {
  it('lit le BPMN dont le processus porte l’id du parcours', () => {
    expect(readBpmn(pilot, repos).processId).toBe(pilot.id);
  });

  it('refuse un dossier BPMN sans le bon processus', () => {
    expect(() => readBpmn({ ...pilot, id: 'autre' }, repos)).toThrow(/aucun processus « autre ».*pilot-account-opening/);
    expect(() => readBpmn(pilot, absent)).toThrow(SourceError);
  });

  it('lit le front et les tests du parcours, specs partagées comprises', () => {
    expect(readFront(pilot, repos).groups).toEqual(Object.keys(pilot.sessions));
    const scan = readTests(pilot, repos);
    expect(scan.files).toContain('tests/ui/shared/post-deployment.spec.ts');
    expect(() => readTests(pilot, absent)).toThrow(/dépôt de tests introuvable/);
  });

  it('chaque session de la config a une session BPMN (déclarée ou évaluée)', () => {
    const bpmn = readBpmn(pilot, repos);
    const named = new Set(bpmn.sessions.flatMap((s) => (s.sessionName ? [s.sessionName] : pilot.bpmnSessions?.[s.id] ?? [])));
    expect([...named].sort()).toEqual(Object.keys(pilot.sessions).sort());
  });
});
