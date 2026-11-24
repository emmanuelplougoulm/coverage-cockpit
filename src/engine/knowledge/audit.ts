import type { CoverageView, TestRef } from '../../core/coverage';
import type { AssertionAudit, AuditedControl, AuditedFact, Intention, Knowledge, Layer } from '../../core/knowledge';

/**
 * Audit des assertions (§14), sur la suite workflow : chaque contrôle d'un
 * test est classé (intention, couche, force, brique) ; puis chaque fait du
 * BPMN est manquant, atteint ou contrôlé. Le taux « contrôlé » est un
 * majorant : le lien est fait par test, pas par étape du test.
 */

const leaf = (check: string) => check.slice(check.lastIndexOf('.') + 1);

function guessLayer(check: string, strength: string): Layer | null {
  if (check.startsWith('expect.')) return 'Test';
  if (strength === 'visuel') return /email/i.test(check) ? 'E-mail' : 'Client';
  if (/email|mail/i.test(check)) return 'E-mail';
  if (/document|pdf/i.test(check)) return 'Document';
  if (/decision|backoffice/i.test(check)) return 'MO';
  if (/status|api|case/i.test(check)) return 'API';
  return null;
}

export function auditAssertions(view: CoverageView, knowledge: Knowledge): AssertionAudit {
  const intentions: (Intention & { brick: string })[] = Object.entries(knowledge.patterns).flatMap(([brick, p]) => p.intentions.map((i) => ({ ...i, brick })));
  const byCheck = (check: string) => intentions.filter((i) => i.checks.includes(check) || i.checks.includes(leaf(check)));
  const testRef = new Map(view.tests.map((t) => [t.id, t]));

  const controls: AuditedControl[] = [];
  let guards = 0;
  for (const [id, checks] of Object.entries(view.testChecks)) {
    for (const c of checks) {
      if (c.kind === 'guard') {
        guards++;
        continue;
      }
      const its = byCheck(c.check);
      controls.push({
        test: testRef.get(id) ?? { id, file: '', line: 0 },
        check: c.check,
        strength: c.strength,
        layer: its[0]?.layer ?? guessLayer(c.check, c.strength),
        intentions: [...new Set(its.map((i) => i.id))],
        brick: its[0]?.brick ?? null,
      });
    }
  }

  const byLayer: AssertionAudit['byLayer'] = {};
  for (const c of controls) {
    const k = c.layer ?? '?';
    byLayer[k] ??= { count: 0, valeur: 0, presence: 0, visuel: 0 };
    byLayer[k].count++;
    byLayer[k][c.strength]++;
  }

  // Qui atteint quoi dans cette suite : cellules + sessions soumises.
  const reach = new Map<string, Set<string>>();
  const add = (k: string, t: string) => reach.set(k, (reach.get(k) ?? new Set()).add(t));
  for (const s of view.sessions) for (const st of s.states) for (const c of Object.values(st.byLocale)) for (const t of c.tests) add(`${st.group}.${st.key}`, t.id);
  for (const e of view.emails) for (const v of e.variants) for (const c of Object.values(v.byLocale)) for (const t of c.tests) add(`email:${e.template}`, t.id);
  for (const [t, groups] of Object.entries(view.testSessions)) for (const g of groups) add(`session:${g}`, t);

  const brickOf = (ref: string) => view.bricks.find((b) => b.ref === ref)?.brick ?? null;
  const intentionTests = (id: string) => new Set(controls.filter((c) => c.intentions.includes(id)).map((c) => c.test.id));

  const facts: AuditedFact[] = view.bpmn.map((b) => {
    const exp = knowledge.expectations.find((x) => x.kind === b.kind && new RegExp(x.name, 'i').test(`${b.label} ${b.id}`));
    const expected = (exp?.expect ?? []).map((id) => intentions.find((i) => i.id === id)!).filter(Boolean).map((i) => ({ id: i.id, label: i.label, layer: i.layer }));
    // Brique : celle de la session, sinon du sous-processus englobant, sinon transverse.
    const owner = b.kind === 'session' ? b.id : b.scope?.at(-1);
    const brick = (owner ? brickOf(`bpmn:${owner}`) : null) ?? 'transverse';
    const base = { id: b.id, kind: b.kind, label: b.label, brick, expected, controlledBy: {}, missingIntentions: [], traversedOnly: [] as string[] };
    if (b.status === 'excluded' || b.status === 'unlinked') {
      // Hors total : rien n'y est « manquant ».
      return { ...base, status: b.status, ...(b.reason ? { reason: b.reason } : {}), reachedBy: [] };
    }
    const keys = [...b.links, ...(b.kind === 'session' ? b.links.map((l) => `session:${l.slice(0, l.indexOf('.'))}`) : [])];
    const reachedIds = new Set(keys.flatMap((k) => [...(reach.get(k) ?? [])]));
    const reachedBy = [...reachedIds].map((id) => testRef.get(id) ?? ({ id, file: '', line: 0 } as TestRef));
    const controlledBy: Record<string, string[]> = {};
    for (const e of expected) controlledBy[e.id] = [...intentionTests(e.id)].filter((t) => reachedIds.has(t));
    const missingIntentions = expected.filter((e) => !controlledBy[e.id]!.length).map((e) => e.id);
    const controlling = new Set(Object.values(controlledBy).flat());
    const status = !reachedBy.length ? 'missing' : missingIntentions.length ? 'reached' : 'controlled';
    return { ...base, status, reachedBy, controlledBy, missingIntentions, traversedOnly: [...reachedIds].filter((t) => !controlling.has(t) && expected.length > 0) };
  });

  const counted = facts.filter((f) => f.status !== 'excluded' && f.status !== 'unlinked');
  return {
    journey: view.journey,
    controls,
    guards,
    byLayer,
    intentions: intentions
      .filter((i, n, all) => all.findIndex((x) => x.id === i.id) === n)
      .map((i) => ({ id: i.id, label: i.label, brick: i.brick, layer: i.layer, core: i.core, tests: [...intentionTests(i.id)] })),
    facts,
    rate: {
      controlled: counted.filter((f) => f.status === 'controlled').length,
      reached: counted.filter((f) => f.status !== 'missing').length,
      total: counted.length,
    },
  };
}
