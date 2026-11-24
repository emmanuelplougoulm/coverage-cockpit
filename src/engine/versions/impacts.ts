import type { CoverageView, Suite, TestRef } from '../../core/coverage';
import type { JourneyConfig } from '../../core/journey';
import type { BpmnDiff, ImpactedElement, ImpactsResult } from '../../core/versions';
import type { BpmnModel } from '../parsers/bpmn';

/**
 * Tests impactés par un changement de BPMN (§12). Un élément changé touche :
 * - directement ce qu'il prouve lui-même : un e-mail (son gabarit), une
 *   branche (ses preuves décidées), une session (ses états) ;
 * - via le sous-processus sinon : les états de la session qui l'englobe.
 * Puis les tests qui atteignent ces états / e-mails, dans les deux suites.
 */
export function impactsOf(
  journey: string,
  from: string,
  to: string,
  diff: BpmnDiff,
  before: BpmnModel,
  after: BpmnModel,
  config: JourneyConfig,
  views: Record<Suite, CoverageView>,
): ImpactsResult {
  const groupsOf = (m: BpmnModel, sessionId: string): string[] => {
    const s = m.sessions.find((x) => x.id === sessionId);
    return config.bpmnSessions?.[sessionId] ?? (s?.sessionName ? [s.sessionName] : []);
  };
  const statesOf = (groups: string[]): string[] =>
    views.ui.sessions.filter((s) => groups.includes(s.group)).flatMap((s) => s.states.map((st) => `${st.group}.${st.key}`));

  // Qui atteint quoi, par suite.
  const reach = new Map<string, Map<string, { test: TestRef; suite: Suite }>>();
  const add = (link: string, t: TestRef, suite: Suite) => {
    const m = reach.get(link) ?? new Map();
    m.set(`${suite}|${t.id}`, { test: t, suite });
    reach.set(link, m);
  };
  for (const suite of ['ui', 'workflow'] as const) {
    const v = views[suite];
    for (const s of v.sessions) for (const st of s.states) for (const c of Object.values(st.byLocale)) for (const t of c.tests) add(`${st.group}.${st.key}`, t, suite);
    for (const e of v.emails) for (const va of e.variants) for (const c of Object.values(va.byLocale)) for (const t of c.tests) add(`email:${e.template}`, t, suite);
  }

  const elements: ImpactedElement[] = [];
  const changes = [
    ...diff.added.map((d) => ({ d, change: 'added' as const, model: after })),
    ...diff.modified.map((d) => ({ d, change: 'modified' as const, model: after })),
    ...diff.removed.map((d) => ({ d, change: 'removed' as const, model: before })),
  ];
  for (const { d, change, model } of changes) {
    const email = model.emails.find((e) => e.taskId === d.id);
    const branch = model.branches.find((b) => b.flowId === d.id);
    const session = model.sessions.find((s) => s.id === d.id);
    let kind: ImpactedElement['kind'] = 'none';
    let links: string[] = [];
    let via: string | undefined;
    if (email?.template) {
      kind = 'direct';
      links = [`email:${email.template}`];
    } else if (branch && config.bpmnBranches?.[branch.key]?.length) {
      kind = 'direct';
      links = config.bpmnBranches[branch.key]!;
    } else if (session) {
      kind = 'direct';
      links = statesOf(groupsOf(model, session.id));
    } else {
      const owner = [...d.scope].reverse().find((sp) => model.sessions.some((s) => s.id === sp));
      if (owner) {
        kind = 'via-subprocess';
        via = owner;
        links = statesOf(groupsOf(model, owner));
      }
    }
    const tests = new Map<string, TestRef>();
    for (const l of links) for (const r of reach.get(l)?.values() ?? []) tests.set(r.test.id, r.test);
    elements.push({
      id: d.id,
      type: d.type,
      ...(d.name ? { name: d.name } : {}),
      change,
      scope: d.scope,
      ...('reasons' in d ? { reasons: (d as { reasons: ImpactedElement['reasons'] }).reasons! } : {}),
      kind,
      ...(via ? { via } : {}),
      links,
      tests: [...tests.values()],
    });
  }

  const perTest = new Map<string, ImpactsResult['tests'][number]>();
  for (const e of elements) {
    for (const l of e.links) {
      for (const r of reach.get(l)?.values() ?? []) {
        const k = `${r.suite}|${r.test.id}`;
        const entry = perTest.get(k) ?? { test: r.test, suite: r.suite, direct: [], via: [] };
        const list = e.kind === 'direct' ? entry.direct : entry.via;
        if (!list.includes(e.id)) list.push(e.id);
        perTest.set(k, entry);
      }
    }
  }
  // Un test touché directement par un élément ne l'est pas « aussi » par son sous-processus.
  for (const t of perTest.values()) t.via = t.via.filter((id) => !t.direct.includes(id));

  return {
    journey,
    from,
    to,
    diff,
    elements,
    tests: [...perTest.values()].sort((a, b) => b.direct.length - a.direct.length || b.via.length - a.via.length || (a.test.id < b.test.id ? -1 : 1)),
  };
}
