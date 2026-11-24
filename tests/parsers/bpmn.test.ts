import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BpmnParseError, parseBpmn } from '../../src/engine/parsers/bpmn';
import { CORPUS } from '../corpus';

const xml = readFileSync(join(CORPUS.workflow, 'processes/pilot-account-opening/pilot-account-opening.bpmn'), 'utf8');
const model = parseBpmn(xml);
const session = (id: string) => model.sessions.find((s) => s.id === id)!;
const email = (t: string) => model.emails.find((e) => e.template === t)!;

const wrap = (body: string) => `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
<bpmn:message id="M" name="session-submitted"/>
<bpmn:process id="p">${body}</bpmn:process></bpmn:definitions>`;

describe('parseBpmn — corpus pilote', () => {
  it('identifie le processus', () => {
    expect(model.processId).toBe('pilot-account-opening');
  });

  it('trouve les six sessions, dans l’ordre du fichier', () => {
    expect(model.sessions.map((s) => s.id)).toEqual(['onboarding', 'applicant', 'scan-id', 'documents', 'signature', 'closing']);
  });

  it('évalue sessionName, y compris par concaténation', () => {
    expect(session('onboarding').sessionName).toBe('ONBOARDING_STEPS');
    expect(session('scan-id').sessionName).toBe('SCAN_ID_STEPS');
    expect(session('scan-id').worker).toBe('client-session-v2');
  });

  it('laisse null un sessionName variable, avec son expression', () => {
    expect(session('documents').sessionName).toBeNull();
    expect(session('documents').sessionNameExpression).toBe('=sessionPrefix + "_STEPS"');
  });

  it('ordonne les statuts selon l’ordre canonique', () => {
    expect(session('onboarding').statuses).toEqual(['submitted', 'canceled']);
    expect(session('scan-id').statuses).toEqual(['processed', 'blocked']);
  });

  it('liste les sorties : fin, erreur, escalade, erreur interceptée', () => {
    expect(session('onboarding').exits).toContainEqual({ elementId: 'onb_end_canceled', kind: 'error', code: 'CANCELED', name: 'Canceled by applicant' });
    expect(session('signature').exits.map((e) => [e.kind, e.code])).toEqual([['end', undefined], ['escalation', 'OTP_LOCKED']]);
    expect(session('scan-id').exits).toContainEqual({ elementId: 'scan_provider_down', kind: 'caught-error', code: 'PROVIDER_DOWN', name: 'Provider down' });
  });

  it('ne prend pas les sous-processus techniques ou sans écran pour des sessions', () => {
    const ids = model.sessions.map((s) => s.id);
    for (const id of ['init-case', 'review', 'archive-case']) expect(ids).not.toContain(id);
  });

  it('lit les cinq e-mails et leur déclencheur', () => {
    expect(model.emails.map((e) => [e.template, e.trigger])).toEqual([
      ['welcome', 'flow'],
      ['documents-reminder', 'timer'],
      ['application-rejected', 'decision'],
      ['advisor-notification', 'decision'],
      ['account-opened', 'flow'],
    ]);
  });

  it('lit le modèle d’un e-mail v4 dans le payload et ses objets dans un contexte', () => {
    const e = email('documents-reminder');
    expect(e.workerVersion).toBe('v4');
    expect(e.subjects).toEqual({ fr: ['Il manque des pièces'], en: ['Documents are missing'] });
  });

  it('garde les variantes d’objet et la langue fixe', () => {
    expect(email('application-rejected').subjects.fr).toEqual(['Votre demande n’a pas abouti…', 'Votre demande est refusée']);
    expect(email('advisor-notification').fixedLocale).toBe('fr');
    expect(email('welcome').fixedLocale).toBeUndefined();
  });

  it('lit la règle de dossier (gamme) et ses variables', () => {
    expect(email('welcome').folderRules).toEqual([
      { input: 'folder', expression: '=if cardRange = "premium" then "premium" else null', variables: ['cardRange'], folders: ['premium', null] },
    ]);
  });

  it('relie un e-mail aux branches traversées', () => {
    expect(email('application-rejected').via).toEqual(['review/rejected']);
    expect(email('welcome').via).toEqual([]);
  });

  it('liste la décision back-office et les quatre branches', () => {
    expect(model.decisions).toEqual([{ elementId: 'rev_decision', message: 'back-office-decision', kind: 'decision', scope: ['review'] }]);
    expect(model.branches.map((b) => [b.key, b.isDefault])).toEqual([
      ['review/approved', true],
      ['review/rejected', false],
      ['review/more-documents', false],
      ['review/fraud-check', false],
    ]);
    expect(model.branches[3]?.condition).toBe('=fraudScore > 80');
  });

  it('indexe chaque élément avec sa portée', () => {
    expect(model.elements.find((e) => e.id === 'sig_end_locked')).toMatchObject({ id: 'sig_end_locked', type: 'endEvent', name: 'OTP locked', scope: ['signature'] });
  });

  it('garde câblage, condition et configuration canonique (base du diff)', () => {
    expect(model.elements.find((e) => e.id === 'fraud-check')).toMatchObject({ source: 'rev_gw', target: 'rev_fraud', condition: '=fraudScore > 80' });
    expect(JSON.parse(model.elements.find((e) => e.id === 'sig_end_locked')!.config!)).toEqual({ event: { kind: 'escalationEventDefinition', ref: 'OTP_LOCKED' } });
    expect(JSON.parse(model.elements.find((e) => e.id === 'doc_reminder_timer')!.config!)).toMatchObject({ event: { timer: 'timeCycle=R3/P3D' }, attachedToRef: 'doc_session', cancelActivity: 'false' });
  });
});

describe('parseBpmn — cas limites', () => {
  it('refuse un XML illisible ou sans processus', () => {
    expect(() => parseBpmn('<not-xml')).toThrow(BpmnParseError);
    expect(() => parseBpmn('<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="x"/>')).toThrow(/process/);
  });

  it('ignore un worker de session sans message de statut', () => {
    const m = parseBpmn(wrap(`<bpmn:subProcess id="sp"><bpmn:serviceTask id="t"><bpmn:extensionElements>
      <zeebe:taskDefinition type="client-session"/></bpmn:extensionElements></bpmn:serviceTask></bpmn:subProcess>`));
    expect(m.sessions).toEqual([]);
  });

  it('prend le sous-processus le plus proche qui porte les messages', () => {
    const m = parseBpmn(wrap(`<bpmn:subProcess id="outer"><bpmn:subProcess id="inner">
      <bpmn:serviceTask id="t"><bpmn:extensionElements><zeebe:taskDefinition type="client-session"/></bpmn:extensionElements></bpmn:serviceTask>
      <bpmn:intermediateCatchEvent id="c"><bpmn:messageEventDefinition messageRef="M"/></bpmn:intermediateCatchEvent>
      <bpmn:endEvent id="e"/></bpmn:subProcess><bpmn:endEvent id="outer_end"/></bpmn:subProcess>`));
    expect(m.sessions.map((s) => [s.id, s.scope, s.exits.map((x) => x.elementId)])).toEqual([['inner', ['outer'], ['e']]]);
    expect(m.sessions[0]?.sessionName).toBeNull();
  });

  it('ignore une passerelle de jonction (une seule sortie)', () => {
    const m = parseBpmn(wrap(`<bpmn:exclusiveGateway id="g"/><bpmn:sequenceFlow id="f" sourceRef="g" targetRef="x"/><bpmn:endEvent id="x"/>`));
    expect(m.branches).toEqual([]);
  });
});
