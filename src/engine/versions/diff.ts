import type { BpmnDiff, DiffItem, DiffReason } from '../../core/versions';
import type { BpmnElement, BpmnModel } from '../parsers/bpmn';

/**
 * Diff de deux versions d'un BPMN (§5.1) : éléments ajoutés, supprimés,
 * modifiés (raison : nom, câblage, configuration, condition), portée =
 * sous-processus englobants ; sessions, e-mails et décisions apparus ou disparus.
 */

const item = (e: BpmnElement): DiffItem => ({ id: e.id, type: e.type, ...(e.name ? { name: e.name } : {}), scope: e.scope });

/** Câblage d'un nœud : ses flux entrants et sortants (ids), triés. */
function wiring(model: BpmnModel): Map<string, string> {
  const io = new Map<string, { in: string[]; out: string[] }>();
  for (const f of model.elements.filter((e) => e.type === 'sequenceFlow')) {
    const s = io.get(f.source ?? '') ?? { in: [], out: [] };
    s.out.push(f.id);
    io.set(f.source ?? '', s);
    const t = io.get(f.target ?? '') ?? { in: [], out: [] };
    t.in.push(f.id);
    io.set(f.target ?? '', t);
  }
  return new Map([...io.entries()].map(([k, v]) => [k, `${v.in.sort().join(',')}>${v.out.sort().join(',')}`]));
}

const setDiff = <T>(a: T[], b: T[]) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });

export function diffBpmn(before: BpmnModel, after: BpmnModel): BpmnDiff {
  const a = new Map(before.elements.map((e) => [e.id, e]));
  const b = new Map(after.elements.map((e) => [e.id, e]));
  const wa = wiring(before);
  const wb = wiring(after);

  const added = after.elements.filter((e) => !a.has(e.id)).map(item);
  const removed = before.elements.filter((e) => !b.has(e.id)).map(item);
  const modified: BpmnDiff['modified'] = [];
  for (const e of after.elements) {
    const old = a.get(e.id);
    if (!old) continue;
    const reasons: DiffReason[] = [];
    if ((old.name ?? '') !== (e.name ?? '')) reasons.push('name');
    const rewired = e.type === 'sequenceFlow' ? old.source !== e.source || old.target !== e.target : (wa.get(e.id) ?? '') !== (wb.get(e.id) ?? '');
    if (rewired || old.type !== e.type || old.scope.join('/') !== e.scope.join('/')) reasons.push('wiring');
    if ((old.config ?? '') !== (e.config ?? '')) reasons.push('configuration');
    if ((old.condition ?? '') !== (e.condition ?? '')) reasons.push('condition');
    if (reasons.length) modified.push({ ...item(e), reasons });
  }

  const sessionKey = (m: BpmnModel) => m.sessions.map((s) => `${s.id}${s.sessionName ? `:${s.sessionName}` : ''}`);
  const emailKey = (m: BpmnModel) => m.emails.map((e) => e.template ?? `?${e.taskId}`);
  const decisionKey = (m: BpmnModel) => m.decisions.map((d) => d.elementId);

  return {
    added,
    removed,
    modified,
    sessions: setDiff(sessionKey(before), sessionKey(after)),
    emails: setDiff(emailKey(before), emailKey(after)),
    decisions: setDiff(decisionKey(before), decisionKey(after)),
  };
}
