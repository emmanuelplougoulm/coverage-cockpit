import { describe, expect, it } from 'vitest';
import type { JourneyConfig } from '../src/core/journey';
import { runCommand, UsageError } from '../src/engine/cli';
import { summarizeJourneys } from '../src/engine/journeys';
import { resolveRepos } from '../src/engine/repos';
import { pilot } from '../src/journeys/pilot';

const allExist = () => true;

describe('resolveRepos', () => {
  it('suit la convention du poste, surchargeable par variable', () => {
    const r = resolveRepos({ CC_REPO_FRONT: '/x/front' }, '/home/u', allExist);
    expect(r.workflow).toMatchObject({ path: '/home/u/dev/repo-workflow', overridden: false });
    expect(r.front).toMatchObject({ path: '/x/front', overridden: true, envVar: 'CC_REPO_FRONT' });
  });

  it('ignore une variable vide', () => {
    expect(resolveRepos({ CC_REPO_E2E: '  ' }, '/h', allExist).e2e.overridden).toBe(false);
  });
});

describe('summarizeJourneys', () => {
  const repos = resolveRepos({}, '/h', allExist);

  it('marque prêt quand toutes les sources existent', () => {
    const { journeys } = summarizeJourneys([pilot], repos, allExist, pilot.id);
    expect(journeys[0]).toMatchObject({ id: pilot.id, pilot: true, status: 'ready', issues: [] });
    expect(journeys[0]?.bpmnDir.path).toBe(`/h/dev/repo-workflow/${pilot.bpmnDir}`);
    expect(journeys[0]?.sessions[0]).toBe('Accueil et orientation');
  });

  it("marque incomplet si une spec manque, ou si le dépôt n'existe pas", () => {
    const noSpec = (p: string) => !p.endsWith(pilot.specs[1]!);
    expect(summarizeJourneys([pilot], repos, noSpec, pilot.id).journeys[0]?.status).toBe('incomplete');
    const noRepos = resolveRepos({}, '/h', () => false);
    const j = summarizeJourneys([pilot], noRepos, allExist, pilot.id).journeys[0];
    expect(j?.status).toBe('incomplete');
    expect(j?.frontPackage.exists).toBe(false);
  });

  it('marque invalide une config fautive, avec ses problèmes', () => {
    const bad: JourneyConfig = { ...pilot, id: 'bad', locales: [] };
    const j = summarizeJourneys([bad], repos, allExist, pilot.id).journeys[0];
    expect(j).toMatchObject({ status: 'invalid', pilot: false });
    expect(j?.issues.map((i) => i.field)).toContain('locales');
  });
});

describe('runCommand', () => {
  const table = { echo: (args: string[]) => ({ args }) };

  it('imprime le JSON de la sous-commande', async () => {
    expect(await runCommand(['echo', 'a', 'b c'], table)).toBe('{"args":["a","b c"]}');
  });

  it("refuse l'absence ou l'inconnu par une erreur d'usage", async () => {
    await expect(runCommand([], table)).rejects.toThrow(UsageError);
    await expect(runCommand(['nope'], table)).rejects.toThrow(/inconnue : nope/);
  });

  it('exige un parcours connu pour bpmn, front, scan, coverage et history', async () => {
    for (const c of ['bpmn', 'front', 'scan', 'coverage', 'history']) {
      await expect(runCommand([c])).rejects.toThrow(UsageError);
      await expect(runCommand([c, 'nope'])).rejects.toThrow(/parcours inconnu : nope/);
    }
    await expect(runCommand(['coverage', 'pilot-account-opening', '--suite', 'x'])).rejects.toThrow(/--suite/);
  });

  it('expose journeys dans la table réelle', async () => {
    const out = JSON.parse(await runCommand(['journeys']));
    expect(out.journeys.map((j: { id: string }) => j.id)).toContain(pilot.id);
    expect(out.repos).toHaveLength(3);
  });
});
