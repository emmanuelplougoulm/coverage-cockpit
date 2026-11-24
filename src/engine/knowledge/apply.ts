import type { BrickAssignment, Bricks, Decision } from '../../core/knowledge';
import type { CatalogOutcome } from '../../core/coverage';
import type { JourneyConfig } from '../../core/journey';
import type { BpmnModel } from '../parsers/bpmn';
import type { FrontModel } from '../parsers/front';

/**
 * Catalogue de décisions (§14) appliqué à une config `catalog: true`, là où
 * elle ne dit rien. Pure : rend une nouvelle config et ce qui a été appliqué
 * ou reste à trancher. La config écrite à la main l'emporte toujours.
 */
export function applyCatalog(
  config: JourneyConfig,
  decisions: Decision[],
  bpmn: BpmnModel,
  front: FrontModel,
): { config: JourneyConfig; outcome: CatalogOutcome } {
  const outcome: CatalogOutcome = { applied: [], pending: [] };
  if (!config.catalog) return { config, outcome };
  const c: JourneyConfig = {
    ...config,
    excludedStates: [...config.excludedStates],
    excludedEmailTemplates: [...(config.excludedEmailTemplates ?? [])],
    excludedBpmnSteps: [...config.excludedBpmnSteps],
    bpmnTechnicalSteps: [...(config.bpmnTechnicalSteps ?? [])],
    bpmnBranches: { ...(config.bpmnBranches ?? {}) },
    bpmnBranchSources: { ...(config.bpmnBranchSources ?? {}) },
  };
  for (const key of Object.keys(config.bpmnBranches ?? {})) c.bpmnBranchSources![key] ??= 'config';
  const active = decisions.filter((d) => !d.exceptions.includes(config.id));
  const states = front.states.map((s) => `${s.group}.${s.key}`).filter((r) => !c.excludedStates.includes(r));
  const subprocesses = bpmn.elements.filter((e) => e.type === 'subProcess').map((e) => e.id);
  const addOnce = (list: string[], v: string) => (list.includes(v) ? false : (list.push(v), true));

  for (const d of active) {
    if (d.kind === 'branch') {
      const ev = new RegExp(d.event!, 'i');
      const sp = d.subprocess ? new RegExp(d.subprocess) : null;
      for (const b of bpmn.branches) {
        if (c.bpmnBranches![b.key] !== undefined) continue; // config ou décision précédente : on ne touche pas
        if (!ev.test(b.name ?? b.flowId)) continue;
        if (sp && !sp.test(b.scope.at(-1) ?? '')) continue;
        if (d.links === 'none') {
          c.bpmnBranches![b.key] = [];
          c.bpmnBranchSources![b.key] = `catalogue ${d.id}`;
          outcome.applied.push({ decision: d.id, target: b.key, value: 'aucune preuve visible' });
          continue;
        }
        const [kind, src] = [d.links!.slice(0, d.links!.indexOf(':')), d.links!.slice(d.links!.indexOf(':') + 1)];
        const re = new RegExp(src);
        const candidates =
          kind === 'email'
            ? [...new Set(bpmn.emails.map((e) => e.template).filter((t): t is string => !!t && re.test(t)))].map((t) => `email:${t}`)
            : states.filter((r) => re.test(r));
        if (candidates.length === 1) {
          c.bpmnBranches![b.key] = candidates;
          c.bpmnBranchSources![b.key] = `catalogue ${d.id}`;
          outcome.applied.push({ decision: d.id, target: b.key, value: candidates[0]! });
        } else {
          outcome.pending.push({ decision: d.id, target: b.key, candidates, why: d.why });
        }
      }
      continue;
    }
    const re = new RegExp(d.pattern!);
    if (d.kind === 'excludeState') {
      for (const r of states.filter((x) => re.test(x))) if (addOnce(c.excludedStates, r)) outcome.applied.push({ decision: d.id, target: r, value: 'exclu' });
    } else if (d.kind === 'excludeTemplate') {
      for (const t of front.emails.map((e) => e.template).filter((x) => re.test(x))) if (addOnce(c.excludedEmailTemplates!, t)) outcome.applied.push({ decision: d.id, target: t, value: 'exclu' });
    } else if (d.kind === 'excludeBpmnStep') {
      for (const s of subprocesses.filter((x) => re.test(x))) if (addOnce(c.excludedBpmnSteps, s)) outcome.applied.push({ decision: d.id, target: s, value: 'exclu' });
    } else if (d.kind === 'technicalStep') {
      for (const s of subprocesses.filter((x) => re.test(x))) if (addOnce(c.bpmnTechnicalSteps!, s)) outcome.applied.push({ decision: d.id, target: s, value: 'technique' });
    }
  }
  return { config: c, outcome };
}

/** Briques métier (§14) : état, puis groupe, puis sous-processus ; premier match gagne ; sinon « à classer ». */
export function assignBricks(bricks: Bricks, groups: string[], states: string[], subprocesses: { id: string; name?: string; groups?: string[] }[]): BrickAssignment[] {
  const first = (rules: Bricks['front'], v: string): BrickAssignment | null => {
    const r = rules.find((x) => new RegExp(x.match).test(v));
    return r ? { ref: v, brick: r.brick, confidence: r.confidence, rule: r.match, ...(r.note ? { note: r.note } : {}) } : null;
  };
  const out: BrickAssignment[] = [];
  for (const g of groups) out.push(first(bricks.front, g) ?? { ref: g, brick: null, confidence: null });
  for (const s of states) {
    const a = first(bricks.states, s);
    if (a) out.push(a);
  }
  for (const sp of subprocesses) {
    const a = first(bricks.subprocesses, sp.id) ?? (sp.name ? first(bricks.subprocesses, sp.name) : null);
    // Un sous-processus qui porte une session prend la brique de sa session front.
    const viaSession = !a && sp.groups?.length ? out.find((x) => x.ref === sp.groups![0] && x.brick) : undefined;
    if (a) out.push({ ...a, ref: `bpmn:${sp.id}` });
    else if (viaSession) out.push({ ...viaSession, ref: `bpmn:${sp.id}`, note: `par sa session ${sp.groups![0]}` });
    else out.push({ ref: `bpmn:${sp.id}`, brick: null, confidence: null });
  }
  return out;
}
