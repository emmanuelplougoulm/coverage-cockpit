import { describe, expect, it } from 'vitest';
import { evaluateFeel, feelNames, feelStrings } from '../src/core/feel';

describe('evaluateFeel', () => {
  it('lit les littéraux, avec ou sans =', () => {
    expect(evaluateFeel('="ONBOARDING_STEPS"')).toEqual({ kind: 'values', values: ['ONBOARDING_STEPS'] });
    expect(evaluateFeel('texte brut')).toEqual({ kind: 'values', values: ['texte brut'] });
    expect(evaluateFeel('=42')).toEqual({ kind: 'values', values: [42] });
    expect(evaluateFeel('=null')).toEqual({ kind: 'values', values: [null] });
  });

  it('concatène les chaînes connues', () => {
    expect(feelStrings(evaluateFeel('="SCAN_" + "ID_STEPS"'))).toEqual(['SCAN_ID_STEPS']);
    expect(feelStrings(evaluateFeel('="a\\"b"'))).toEqual(['a"b']);
  });

  it('garde les deux branches d’un if comme alternatives', () => {
    expect(feelStrings(evaluateFeel('=if code = "X" then "A" else "B"'))).toEqual(['A', 'B']);
    const v = evaluateFeel('=if range = "premium" then "premium" else null');
    expect(v).toEqual({ kind: 'values', values: ['premium', null] });
    expect(feelStrings(v)).toBeNull();
  });

  it('combine les alternatives dans une concaténation', () => {
    expect(feelStrings(evaluateFeel('=(if x then "a" else "b") + "-" + (if y then "1" else "2")'))).toEqual(['a-1', 'a-2', 'b-1', 'b-2']);
  });

  it('ne devine jamais une variable', () => {
    expect(evaluateFeel('=sessionPrefix + "_STEPS"')).toEqual({ kind: 'unknown', names: ['sessionPrefix'] });
    expect(evaluateFeel('=if flag then name else "B"')).toEqual({ kind: 'unknown', names: ['flag', 'name'] });
    expect(evaluateFeel('=upper case("a")').kind).toBe('unknown');
  });

  it('lit les contextes et y accède', () => {
    const v = evaluateFeel('={template: "documents-reminder", data: {count: documentsCount}}');
    expect(v.kind).toBe('context');
    if (v.kind !== 'context') return;
    expect(v.entries.template).toEqual({ kind: 'values', values: ['documents-reminder'] });
    expect(v.entries.data).toEqual({ kind: 'context', entries: { count: { kind: 'unknown', names: ['documentsCount'] } } });
    expect(evaluateFeel('={a: "x"}.a')).toEqual({ kind: 'values', values: ['x'] });
  });

  it('rend inconnu une syntaxe illisible au lieu de planter', () => {
    expect(evaluateFeel('="non fermée').kind).toBe('unknown');
    expect(evaluateFeel('=a #').kind).toBe('unknown');
  });
});

describe('feelNames', () => {
  it('liste les variables, sans mots-clés, clés de contexte ni fonctions', () => {
    expect(feelNames('=if cardRange = "premium" then "premium" else null')).toEqual(['cardRange']);
    expect(feelNames('={template: "t", data: {count: documentsCount}}')).toEqual(['documentsCount']);
    expect(feelNames('=count(items) > 3 and customer.age > 18')).toEqual(['items', 'customer']);
    // Limite assumée : les noms FEEL à espaces (« string length ») sont lus comme deux noms.
    expect(feelNames('=string length(x)')).toEqual(['string', 'x']);
    expect(feelNames('littéral')).toEqual([]);
  });
});
