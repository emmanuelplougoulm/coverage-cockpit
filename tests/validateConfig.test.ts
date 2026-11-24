import { describe, expect, it } from 'vitest';
import { fallbackLocale, type JourneyConfig } from '../src/core/journey';
import { validateConfig, validateConfigs } from '../src/core/validateConfig';
import { journeys } from '../src/journeys';
import { pilot } from '../src/journeys/pilot';

const base: JourneyConfig = {
  id: 'j',
  label: 'J',
  sessions: { A_STEPS: 'A' },
  bpmnDir: 'b',
  frontPackage: 'f',
  specs: ['s'],
  locales: ['fr'],
  excludedGroups: [],
  excludedStates: [],
  excludedBpmnSteps: [],
  excludedEmailTriggers: [],
};
const fields = (c: JourneyConfig) => validateConfig(c).map((i) => i.field);

describe('validateConfig', () => {
  it('accepte toutes les configs enregistrées, pilote compris', () => {
    expect(validateConfigs(journeys)).toEqual([]);
    expect(validateConfig(pilot)).toEqual([]);
  });

  it('exige sessions, specs et langues', () => {
    expect(fields({ ...base, sessions: {}, specs: [], locales: [] })).toEqual(['sessions', 'specs', 'locales']);
  });

  it('refuse une langue mal formée, en double, ou un défaut hors liste', () => {
    expect(fields({ ...base, locales: ['FR'] })).toEqual(['locales']);
    expect(fields({ ...base, locales: ['fr', 'fr'] })).toEqual(['locales']);
    expect(fields({ ...base, defaultLocale: 'en' })).toEqual(['defaultLocale']);
    expect(fields({ ...base, locales: ['fr-BE'] })).toEqual([]);
  });

  it('vérifie les références GROUP.KEY des exclusions, alias et chemins', () => {
    expect(fields({ ...base, excludedStates: ['A_STEPS.ok', 'pas-un-etat'] })).toEqual(['excludedStates']);
    expect(fields({ ...base, stepAliases: { 'step-x': 'nope' } })).toEqual(['stepAliases']);
    expect(fields({ ...base, methodStates: { 'P.m': 'A_STEPS.k' } })).toEqual([]);
    expect(
      fields({ ...base, nominalPaths: [{ id: 'p', label: 'P', screens: ['bad'], setup: '' }] }),
    ).toEqual(['nominalPaths']);
  });

  it('signale un chemin nominal en double ou vide', () => {
    const p = { id: 'p', label: 'P', screens: [] as string[], setup: '' };
    expect(fields({ ...base, nominalPaths: [p, p] })).toEqual(['nominalPaths', 'nominalPaths', 'nominalPaths']);
  });

  it('refuse un groupe exclu inconnu des sessions', () => {
    expect(fields({ ...base, excludedGroups: ['B_STEPS'] })).toEqual(['excludedGroups']);
  });

  it('accepte une branche sans preuve visible ([]) mais pas une preuve mal formée', () => {
    expect(fields({ ...base, bpmnBranches: { 'sp/el': [] } })).toEqual([]);
    expect(fields({ ...base, bpmnBranches: { 'sp/el': ['email:tpl-1', 'A_STEPS.k'] } })).toEqual([]);
    expect(fields({ ...base, bpmnBranches: { 'sp/el': ['mail:tpl'] } })).toEqual(['bpmnBranches']);
    expect(fields({ ...base, bpmnBranches: { el: [] } })).toEqual(['bpmnBranches']);
  });

  it('détecte les identifiants de parcours en double', () => {
    expect(validateConfigs([base, base]).map((i) => i.message)).toEqual(['identifiant de parcours en double']);
  });
});

describe('fallbackLocale', () => {
  it('prend le défaut, sinon la langue unique, sinon inconnue', () => {
    expect(fallbackLocale({ locales: ['fr', 'en'], defaultLocale: 'en' })).toBe('en');
    expect(fallbackLocale({ locales: ['nl'] })).toBe('nl');
    expect(fallbackLocale({ locales: ['fr', 'en'] })).toBeNull();
  });
});
