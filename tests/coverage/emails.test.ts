import { describe, expect, it } from 'vitest';
import { computeEmails, normalizeSubject } from '../../src/engine/coverage/emails';
import type { BpmnEmail, BpmnModel } from '../../src/engine/parsers/bpmn';
import type { FrontModel } from '../../src/engine/parsers/front';
import { baseConfig, scanned } from './helpers';

const email = (template: string, subjects: Record<string, string[]>, over: Partial<BpmnEmail> = {}): BpmnEmail => ({
  taskId: `t_${template}`, worker: 'send-email', workerVersion: 'v3', template, trigger: 'flow', via: [], subjects, folderRules: [], scope: [], ...over,
});
const bpmn = (emails: BpmnEmail[]): BpmnModel => ({ processId: 'j', elements: [], sessions: [], emails, decisions: [], branches: [] });
const front = (emails: FrontModel['emails']): FrontModel => ({ skeleton: false, groups: [], states: [], transitions: [], locales: ['en', 'fr'], emails, texts: {}, warnings: [] });
const tpl = (template: string, variants: string[], ranges: Record<string, string[]> = {}) => ({
  template,
  variants: variants.map((variant) => ({ variant, locales: ['en', 'fr'] })),
  ranges: Object.fromEntries(Object.entries(ranges).map(([r, vs]) => [r, vs.map((variant) => ({ variant, locales: ['en', 'fr'] }))])),
  locales: ['en', 'fr'],
});
const cell = (r: ReturnType<typeof computeEmails>, t: string, v: string, l: string) =>
  r.emails.find((e) => e.template === t)?.variants.find((x) => x.variant === v)?.byLocale[l]?.status;

describe('normalizeSubject', () => {
  it('neutralise apostrophes, points de suspension, espaces, ponctuation finale et casse', () => {
    expect(normalizeSubject('Votre demande n’a pas  abouti…')).toBe(normalizeSubject("votre demande n'a pas abouti"));
    expect(normalizeSubject(' Bienvenue ! ')).toBe('bienvenue');
  });
});

describe('computeEmails', () => {
  it('atteint par objet dans la langue du test, couvre par capture, variante par suffixe', () => {
    const r = computeEmails(bpmn([email('rej', { fr: ['Refus'] })]), front([tpl('rej', ['A1', 'B2'])]), baseConfig, [
      { test: scanned('t1', { emailSubjects: ['refus'], emailCaptures: [{ subject: 'Refus', suffix: 'a1', name: null }] }), locales: ['fr'] },
    ]);
    expect(cell(r, 'rej', 'A1', 'fr')).toBe('covered');
    expect(cell(r, 'rej', 'B2', 'fr')).toBe('missing');
    expect(cell(r, 'rej', 'A1', 'en')).toBe('missing');
  });

  it('n’attribue pas un objet partagé par deux gabarits', () => {
    const r = computeEmails(bpmn([email('a', { fr: ['Même'] }), email('b', { fr: ['Même'] })]), front([tpl('a', ['default']), tpl('b', ['default'])]), baseConfig, [
      { test: scanned('t1', { emailSubjects: ['Même'] }), locales: ['fr'] },
    ]);
    expect(r.unattributed).toEqual([{ subject: 'Même', reason: 'shared-subject', templates: ['a', 'b'], tests: [{ id: 't1', file: 'tests/ui/j/a.spec.ts', line: 1 }] }]);
    expect(cell(r, 'a', 'default', 'fr')).toBe('missing');
  });

  it('signale une variante impossible à trancher, et un objet inconnu', () => {
    const r = computeEmails(bpmn([email('rej', { fr: ['Refus'] })]), front([tpl('rej', ['A1', 'B2'])]), baseConfig, [
      { test: scanned('t1', { emailSubjects: ['Refus', 'Autre chose'] }), locales: ['fr'] },
    ]);
    expect(r.unattributed.map((u) => u.reason)).toEqual(['variant', 'unknown-subject']);
  });

  it('choisit la gamme d’après la variable de la règle de dossier', () => {
    const e = email('w', { fr: ['Bienvenue'] }, { folderRules: [{ input: 'folder', expression: '', variables: ['range'], folders: ['gold', null] }] });
    const r = computeEmails(bpmn([e]), front([tpl('w', ['default'], { gold: ['default'], silver: ['default'] })]), baseConfig, [
      { test: scanned('t1', { emailSubjects: ['Bienvenue'], caseValues: { range: 'gold' } }), locales: ['fr'] },
    ]);
    expect(r.emails[0]?.variants.map((v) => v.variant)).toEqual(['default', 'gold/default']);
    expect(cell(r, 'w', 'gold/default', 'fr')).toBe('traversed');
  });

  it('respecte la langue fixe, exclut par déclencheur, liste les gabarits orphelins et manquants', () => {
    const r = computeEmails(
      bpmn([email('adv', { '*': ['Conseiller'] }, { fixedLocale: 'fr' }), email('rem', { fr: ['Relance'] }, { trigger: 'timer' }), email('ghost', { fr: ['Fantôme'] })]),
      front([tpl('adv', ['default']), tpl('rem', ['default']), tpl('old', ['default'])]),
      baseConfig,
      [{ test: scanned('t1', { emailSubjects: ['Conseiller'] }), locales: ['en'] }],
    );
    expect(cell(r, 'adv', 'default', 'fr')).toBe('traversed');
    expect(r.emails.find((e) => e.template === 'adv')?.variants[0]?.byLocale.en).toBeUndefined();
    expect(r.excluded).toEqual([{ id: 'email:rem', reason: 'déclencheur timer hors périmètre (config)' }]);
    expect(r.orphanTemplates).toEqual(['old']);
    expect(r.emails.find((e) => e.template === 'ghost')?.missingTemplate).toBe(true);
  });
});
