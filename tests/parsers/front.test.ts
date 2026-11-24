import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFrontPackage, markerCandidates, parseEmails, parseFront } from '../../src/engine/parsers/front';
import { CORPUS } from '../corpus';

const root = join(CORPUS.front, 'packages/pilot-account-opening');
const model = parseFront(loadFrontPackage(root));
const state = (ref: string) => model.states.find((s) => `${s.group}.${s.key}` === ref);

describe('parseFront — corpus pilote', () => {
  it('lit les groupes dans l’ordre de constants.ts, sans les autres constantes', () => {
    expect(model.groups).toEqual(['ONBOARDING_STEPS', 'APPLICANT_STEPS', 'SCAN_ID_STEPS', 'DOCUMENTS_STEPS', 'SIGNATURE_STEPS', 'CLOSING_STEPS']);
    expect(model.skeleton).toBe(false);
  });

  it('produit un état par étape, avec son nom de classe', () => {
    expect(model.states.filter((s) => s.kind === 'step')).toHaveLength(17);
    expect(state('SCAN_ID_STEPS.captureV2')).toEqual({ group: 'SCAN_ID_STEPS', key: 'captureV2', kind: 'step', stepName: 'id-capture2_1', locales: ['en', 'fr'] });
  });

  it('garde deux états distincts pour un même nom d’étape', () => {
    const sig = model.states.filter((s) => s.stepName === 'signature').map((s) => `${s.group}.${s.key}`);
    expect(sig).toEqual(['SIGNATURE_STEPS.sign', 'CLOSING_STEPS.countersign']);
  });

  it('note les langues où un texte manque', () => {
    expect(state('APPLICANT_STEPS.address')?.locales).toEqual(['fr']);
    expect(state('SIGNATURE_STEPS.lockedError')?.locales).toEqual(['fr']);
  });

  it('range les messages d’état, y compris ceux du parcours, et ignore les autres textes', () => {
    const messages = model.states.filter((s) => s.kind === 'message').map((s) => `${s.group}.${s.key}`);
    expect(messages).toEqual([
      'JOURNEY.internalError',
      'JOURNEY.serverErrorTimeout',
      'APPLICANT_STEPS.deleteDialog',
      'SCAN_ID_STEPS.blockedError',
      'SIGNATURE_STEPS.helperTextOnError',
      'SIGNATURE_STEPS.codeHelperTextOnError',
      'SIGNATURE_STEPS.lockedError',
    ]);
    expect(state('JOURNEY.title')).toBeUndefined();
  });

  it('lit les transitions des cartes d’étapes', () => {
    expect(model.transitions).toContainEqual({ from: 'SCAN_ID_STEPS.retry', to: ['SCAN_ID_STEPS.capture', 'SCAN_ID_STEPS.blocked'] });
    expect(model.transitions).toContainEqual({ from: 'ONBOARDING_STEPS.maintenance', to: [] });
    expect(model.transitions).toHaveLength(17);
  });

  it('lit les gabarits d’e-mails, leurs variantes, langues et gammes', () => {
    expect(model.emails.map((e) => e.template)).toEqual([
      'account-opened', 'advisor-notification', 'application-rejected', 'documents-reminder', 'legacy-newsletter', 'welcome',
    ]);
    const welcome = model.emails.find((e) => e.template === 'welcome')!;
    expect(welcome.ranges).toEqual({ premium: [{ variant: 'default', locales: ['en', 'fr'] }] });
    expect(model.emails.find((e) => e.template === 'application-rejected')?.variants.map((v) => v.variant)).toEqual(['REJ01', 'REJ02', 'default']);
    expect(model.emails.find((e) => e.template === 'advisor-notification')?.locales).toEqual(['fr']);
  });

  it('garde les textes de chaque état, aplatis, par langue (croquis)', () => {
    expect(model.texts.fr?.['APPLICANT_STEPS.identity']).toEqual({ title: 'Vos informations', firstName: 'Prénom' });
    expect(model.texts.en?.['SIGNATURE_STEPS.helperTextOnError']).toEqual({ text: 'Wrong code.' });
    expect(model.texts.en?.['APPLICANT_STEPS.address']).toBeUndefined();
  });

  it('ne signale rien d’anormal sur le pilote', () => {
    expect(model.warnings).toEqual([]);
  });
});

describe('parseFront — cas limites', () => {
  it('rend un parcours squelette sans constants.ts', () => {
    const m = parseFront(loadFrontPackage(join(CORPUS.front, 'packages/skeleton-journey')));
    expect(m).toMatchObject({ skeleton: true, states: [], groups: [] });
  });

  it('lit un export par défaut via une variable, et signale un groupe inconnu', () => {
    const m = parseFront({
      'scripts/constants.ts': "export const A_STEPS = { one: 'one' };",
      'scripts/locales/fr.ts': "const fr = { A_STEPS: { one: { t: 'x' } }, B_STEPS: {} }; export default fr;",
    });
    expect(m.states).toEqual([{ group: 'A_STEPS', key: 'one', kind: 'step', stepName: 'one', locales: ['fr'] }]);
    expect(m.warnings).toEqual(['locales/fr : groupe B_STEPS absent de constants.ts']);
  });

  it('signale un fichier de langue illisible', () => {
    const m = parseFront({ 'scripts/constants.ts': '', 'scripts/locales/en.ts': 'export default build();' });
    expect(m.warnings).toEqual(["scripts/locales/en.ts : pas d'objet littéral exporté par défaut"]);
  });

  it('refuse un package introuvable', () => {
    expect(() => loadFrontPackage('/nonexistent-cc')).toThrow(/introuvable/);
  });
});

describe('parseEmails', () => {
  it('ignore ce qui n’a pas la forme modèle/variante/langue.html', () => {
    expect(parseEmails(['emails/a/default/fr.html', 'emails/README.md', 'emails/a/fr.html', 'emails/a/default/img.png'])).toEqual([
      { template: 'a', variants: [{ variant: 'default', locales: ['fr'] }], ranges: {}, locales: ['fr'] },
    ]);
  });
});

describe('markerCandidates', () => {
  it('mappe une classe SDK et un id de dialogue', () => {
    expect(markerCandidates({ kind: 'class', value: 'journey-error' }, model.states)).toEqual(['JOURNEY.internalError']);
    expect(markerCandidates({ kind: 'id', value: 'deleteDialog' }, model.states)).toEqual(['APPLICANT_STEPS.deleteDialog']);
    expect(markerCandidates({ kind: 'id', value: 'continue' }, model.states)).toEqual([]);
  });
});
