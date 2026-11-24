import { describe, expect, it } from 'vitest';
import {
  channelOf,
  distinctiveWords,
  shotsResolver,
  stepCandidates,
  suffixMessages,
  testResolver,
  type ResolveContext,
} from '../../src/engine/coverage/resolve';
import type { FrontState } from '../../src/engine/parsers/front';
import type { ScreenshotHit, StepHit } from '../../src/engine/parsers/scanTests';

const step = (group: string, key: string, stepName: string): FrontState => ({ group, key, kind: 'step', stepName, locales: ['fr'] });
const msg = (group: string, key: string): FrontState => ({ group, key, kind: 'message', locales: ['fr'] });
const states = [
  step('A_STEPS', 'capture', 'capture'),
  step('A_STEPS', 'captureV2', 'capture2_1'),
  step('A_STEPS', 'help', 'capture-help'),
  step('B_STEPS', 'sign', 'signature'),
  step('C_STEPS', 'countersign', 'signature'),
  step('C_STEPS', 'v3', 'version3'),
  msg('B_STEPS', 'helperTextOnError'),
  msg('B_STEPS', 'codeHelperTextOnError'),
  msg('B_STEPS', 'internalError'),
  msg('JOURNEY', 'internalError'),
];
const ctx = (config: ResolveContext['config'] = {}): ResolveContext => ({ states, config });
const hit = (s: string, match: StepHit['match'] = 'exact', className = `step-${s}`): StepHit => ({ step: s, match, className });

describe('stepCandidates', () => {
  it('trouve le nom exact ; un préfixe ne prend qu’un suffixe de version', () => {
    expect(stepCandidates(hit('capture2_1'), ctx())).toEqual(['A_STEPS.captureV2']);
    expect(stepCandidates(hit('version', 'prefix'), ctx())).toEqual(['C_STEPS.v3']);
    expect(stepCandidates(hit('capture-he', 'prefix'), ctx())).toEqual([]);
  });

  it('préfère le candidat exact au préfixe', () => {
    expect(stepCandidates(hit('capture', 'prefix'), ctx())).toEqual(['A_STEPS.capture']);
  });

  it('rend tous les états qui partagent un nom d’étape', () => {
    expect(stepCandidates(hit('signature'), ctx())).toEqual(['B_STEPS.sign', 'C_STEPS.countersign']);
  });

  it('applique d’abord les alias tranchés à la main, puis la classe SDK accolée', () => {
    expect(stepCandidates(hit('signature'), ctx({ stepAliases: { 'step-signature': 'C_STEPS.countersign' } }))).toEqual(['C_STEPS.countersign']);
    expect(stepCandidates(hit('internalError', 'exact', 'step-internalError journey-error'), ctx())).toEqual(['JOURNEY.internalError']);
  });

  it('se replie sur un message rendu comme classe d’étape, puis sur l’erreur du parcours', () => {
    expect(stepCandidates(hit('internalError'), ctx())).toEqual(['B_STEPS.internalError', 'JOURNEY.internalError']);
    expect(stepCandidates(hit('internal', 'prefix'), ctx())).toEqual(['JOURNEY.internalError']);
    expect(stepCandidates(hit('nothing'), ctx())).toEqual([]);
  });
});

describe('channelOf / testResolver', () => {
  const paths = [
    { id: 'online', label: 'En ligne', screens: ['A_STEPS.capture', 'B_STEPS.sign'], setup: '' },
    { id: 'branch', label: 'Guichet', screens: ['C_STEPS.v3', 'C_STEPS.countersign'], setup: '' },
  ];

  it('choisit le chemin qui contient le plus d’états sûrs ; égalité = aucun', () => {
    expect(channelOf(new Set(['A_STEPS.capture']), paths)?.id).toBe('online');
    expect(channelOf(new Set(['A_STEPS.capture', 'C_STEPS.v3']), paths)).toBeNull();
    expect(channelOf(new Set(['A_STEPS.capture']), [paths[0]!])).toBeNull();
  });

  it('garde les états du chemin du test', () => {
    expect(testResolver(['B_STEPS.sign', 'C_STEPS.countersign'], new Set(), paths[1]!)).toEqual(['C_STEPS.countersign']);
  });

  it('retire les états que le test nomme sans doute ailleurs', () => {
    expect(testResolver(['B_STEPS.sign', 'C_STEPS.countersign'], new Set(['B_STEPS.sign']), null)).toEqual(['C_STEPS.countersign']);
    expect(testResolver(['B_STEPS.sign', 'C_STEPS.countersign'], new Set(), null)).toEqual(['B_STEPS.sign', 'C_STEPS.countersign']);
  });
});

describe('shotsResolver', () => {
  const shot = (suffix: string | null): ScreenshotHit => ({ call: 'validateUI', line: 1, page: [], suffix, trail: [], name: null });
  const labels = { B_STEPS: 'Signature', C_STEPS: 'Clôture' };

  it('retire les mots communs à toutes les captures du test (ex. le canal)', () => {
    const all = [shot('online-signature'), shot('online-countersign'), shot('online-summary')];
    expect(distinctiveWords(all[0]!, all)).toEqual(['signature']);
  });

  it('tranche par mot distinctif (clé ou libellé de session)', () => {
    expect(shotsResolver(['B_STEPS.sign', 'C_STEPS.countersign'], ['countersign'], null, labels)).toEqual(['C_STEPS.countersign']);
    expect(shotsResolver(['B_STEPS.sign', 'C_STEPS.countersign'], ['clôture'], null, labels)).toEqual(['B_STEPS.sign', 'C_STEPS.countersign']);
  });

  it('sinon par la session de la dernière page utilisée', () => {
    expect(shotsResolver(['B_STEPS.sign', 'C_STEPS.countersign'], [], 'C_STEPS', labels)).toEqual(['C_STEPS.countersign']);
    expect(shotsResolver(['B_STEPS.sign', 'C_STEPS.countersign'], [], null, labels)).toHaveLength(2);
  });
});

describe('suffixMessages', () => {
  it('lit un message nommé en kebab dans le suffixe', () => {
    expect(suffixMessages('helper-text-on-error', ['B_STEPS.sign'], states)).toEqual(['B_STEPS.helperTextOnError']);
    expect(suffixMessages('online-code-helper-text-on-error-fr', ['B_STEPS.sign'], states)).toEqual(['B_STEPS.codeHelperTextOnError']);
  });

  it('rend plusieurs messages pour un alias ambigu, aucun hors des groupes de la page', () => {
    expect(suffixMessages('wrong-otp', ['B_STEPS.sign'], states)).toEqual(['B_STEPS.helperTextOnError', 'B_STEPS.codeHelperTextOnError']);
    expect(suffixMessages('helper-text-on-error', ['A_STEPS.capture'], states)).toEqual([]);
    expect(suffixMessages(null, ['B_STEPS.sign'], states)).toEqual([]);
  });
});
