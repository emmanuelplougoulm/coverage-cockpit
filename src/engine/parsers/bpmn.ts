import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import { evaluateFeel, feelNames, feelStrings, type FeelValue } from '../../core/feel';
import {
  DECISION_MESSAGES,
  EMAIL_WORKERS,
  SESSION_MESSAGES,
  SESSION_STATUSES,
  SESSION_WORKERS,
  type SessionStatus,
} from './bpmnTables';

/**
 * Parseur BPMN Zeebe (§5.1). Fonction pure : prend le XML, rend le modèle.
 * Rien n'est deviné : ce que le FEEL ne résout pas reste `null` / inconnu.
 */

export interface BpmnElement {
  id: string;
  /** Nom local de l'élément XML (serviceTask, endEvent…). */
  type: string;
  name?: string;
  /** Sous-processus englobants, du plus extérieur au plus intérieur. */
  scope: string[];
  /** Flux : origine et cible. */
  source?: string;
  target?: string;
  /** Flux : expression de condition. */
  condition?: string;
  /** Configuration canonique (worker, entrées, en-têtes, événement…) : base du diff « configuration ». */
  config?: string;
}

export type ExitKind = 'end' | 'error' | 'escalation' | 'caught-error';

export interface SessionExit {
  elementId: string;
  kind: ExitKind;
  code?: string;
  name?: string;
}

export interface BpmnSession {
  /** Identifiant du sous-processus qui porte la session. */
  id: string;
  name?: string;
  workerTaskId: string;
  worker: string;
  /** Valeur évaluée de l'entrée `sessionName`, ou null si elle dépend d'une variable. */
  sessionName: string | null;
  sessionNameExpression?: string;
  statuses: SessionStatus[];
  exits: SessionExit[];
  scope: string[];
}

export interface FolderRule {
  input: string;
  expression: string;
  variables: string[];
  /** Sous-dossiers possibles (null = dossier racine), ou null si l'expression est inconnue. */
  folders: (string | null)[] | null;
}

export type EmailTrigger = 'flow' | 'timer' | 'decision';

export interface BpmnEmail {
  taskId: string;
  taskName?: string;
  worker: string;
  workerVersion: 'v3' | 'v4';
  template: string | null;
  trigger: EmailTrigger;
  /** Branches de passerelle traversées pour arriver à l'e-mail ("sous-processus/flux"). */
  via: string[];
  /** Langue → objets possibles ; clé `*` si l'objet ne dépend pas de la langue. Inconnu = absent. */
  subjects: Record<string, string[]>;
  fixedLocale?: string;
  folderRules: FolderRule[];
  scope: string[];
}

export interface BpmnDecision {
  elementId: string;
  message: string;
  kind: string;
  scope: string[];
}

export interface BpmnBranch {
  /** "sous-processus/élément", clé de `bpmnBranches` dans la config. */
  key: string;
  flowId: string;
  gatewayId: string;
  name?: string;
  condition?: string;
  isDefault: boolean;
  scope: string[];
}

export interface BpmnModel {
  processId: string;
  processName?: string;
  elements: BpmnElement[];
  sessions: BpmnSession[];
  emails: BpmnEmail[];
  decisions: BpmnDecision[];
  branches: BpmnBranch[];
}

export class BpmnParseError extends Error {}

// ——— utilitaires XML (indépendants des préfixes d'espace de noms) ———

const children = (el: XmlElement): XmlElement[] =>
  Array.from(el.childNodes as unknown as ArrayLike<{ nodeType: number }>).filter((n) => n.nodeType === 1) as unknown as XmlElement[];

const child = (el: XmlElement, local: string): XmlElement | undefined => children(el).find((c) => c.localName === local);

function descendants(el: XmlElement, local: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (e: XmlElement) => {
    for (const c of children(e)) {
      if (c.localName === local) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

const attr = (el: XmlElement, name: string): string | undefined => el.getAttribute(name) ?? undefined;

const FLOW_NODE_TYPES = new Set([
  'task', 'serviceTask', 'userTask', 'sendTask', 'receiveTask', 'scriptTask', 'businessRuleTask', 'callActivity',
  'subProcess', 'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent',
  'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway', 'sequenceFlow',
]);

function taskType(el: XmlElement): string | undefined {
  const ext = child(el, 'extensionElements');
  const def = ext && child(ext, 'taskDefinition');
  return def ? attr(def, 'type') : undefined;
}

function inputs(el: XmlElement): Record<string, string> {
  const ext = child(el, 'extensionElements');
  const io = ext && child(ext, 'ioMapping');
  const out: Record<string, string> = {};
  for (const i of io ? children(io).filter((c) => c.localName === 'input') : []) {
    const target = attr(i, 'target');
    const source = attr(i, 'source');
    if (target && source !== undefined) out[target] = source;
  }
  return out;
}

const eventDefinition = (el: XmlElement): XmlElement | undefined => children(el).find((c) => c.localName?.endsWith('EventDefinition'));

// ——— parseur ———

export function parseBpmn(xml: string): BpmnModel {
  const errors: string[] = [];
  let doc;
  try {
    doc = new DOMParser({
      onError: (level: string, msg: string) => {
        if (level !== 'warning') errors.push(msg);
      },
    }).parseFromString(xml, 'text/xml');
  } catch (e) {
    throw new BpmnParseError(`BPMN illisible : ${e instanceof Error ? e.message : String(e)}`);
  }
  const root = doc.documentElement as unknown as XmlElement | null;
  if (!root || root.localName !== 'definitions' || errors.length) {
    throw new BpmnParseError(`BPMN illisible${errors.length ? ' : ' + errors[0] : ''}`);
  }
  const process = child(root, 'process');
  if (!process) throw new BpmnParseError('aucun <process>');
  const processId = attr(process, 'id') ?? '';

  // Tables globales : messages, erreurs, escalades.
  const messageName = new Map<string, string>();
  for (const m of descendants(root, 'message')) messageName.set(attr(m, 'id') ?? '', attr(m, 'name') ?? '');
  const errorCode = new Map<string, string>();
  for (const e of descendants(root, 'error')) errorCode.set(attr(e, 'id') ?? '', attr(e, 'errorCode') ?? '');
  const escalationCode = new Map<string, string>();
  for (const e of descendants(root, 'escalation')) escalationCode.set(attr(e, 'id') ?? '', attr(e, 'escalationCode') ?? '');

  // Index de tous les nœuds avec leur portée.
  const byId = new Map<string, XmlElement>();
  const scopeOf = new Map<string, string[]>();
  const elements: BpmnElement[] = [];
  const index = (container: XmlElement, scope: string[]) => {
    for (const c of children(container)) {
      if (!c.localName || !FLOW_NODE_TYPES.has(c.localName)) continue;
      const id = attr(c, 'id');
      if (!id) continue;
      byId.set(id, c);
      scopeOf.set(id, scope);
      const name = attr(c, 'name');
      elements.push({ id, type: c.localName, ...(name ? { name } : {}), scope, ...detailsOf(c) });
      if (c.localName === 'subProcess') index(c, [...scope, id]);
    }
  };
  /** Détails stables d'un élément, indépendants de la mise en forme du XML. */
  function detailsOf(c: XmlElement): Partial<BpmnElement> {
    if (c.localName === 'sequenceFlow') {
      const cond = child(c, 'conditionExpression')?.textContent?.trim();
      return { source: attr(c, 'sourceRef') ?? '', target: attr(c, 'targetRef') ?? '', ...(cond ? { condition: cond } : {}) };
    }
    const cfg: Record<string, unknown> = {};
    const type = taskType(c);
    if (type) cfg.task = type;
    const io = inputs(c);
    if (Object.keys(io).length) cfg.inputs = Object.fromEntries(Object.entries(io).sort(([a], [b]) => (a < b ? -1 : 1)));
    const ext = child(c, 'extensionElements');
    const headers = ext && child(ext, 'taskHeaders');
    if (headers) cfg.headers = Object.fromEntries(children(headers).map((h) => [attr(h, 'key') ?? '', attr(h, 'value') ?? '']).sort(([a], [b]) => (a! < b! ? -1 : 1)));
    const def = eventDefinition(c);
    if (def) {
      const ref = attr(def, 'messageRef') ? messageName.get(attr(def, 'messageRef')!) : attr(def, 'errorRef') ? errorCode.get(attr(def, 'errorRef')!) : attr(def, 'escalationRef') ? escalationCode.get(attr(def, 'escalationRef')!) : undefined;
      const timer = children(def).map((t) => `${t.localName}=${t.textContent?.trim()}`).join(';');
      cfg.event = { kind: def.localName, ...(ref ? { ref } : {}), ...(timer ? { timer } : {}) };
    }
    for (const a of ['attachedToRef', 'cancelActivity', 'default', 'messageRef']) {
      const v = attr(c, a);
      if (v !== undefined) cfg[a] = v;
    }
    return Object.keys(cfg).length ? { config: JSON.stringify(cfg) } : {};
  }
  index(process, []);

  const flows = elements.filter((e) => e.type === 'sequenceFlow').map((e) => byId.get(e.id)!);
  const incoming = new Map<string, XmlElement[]>();
  for (const f of flows) {
    const t = attr(f, 'targetRef') ?? '';
    incoming.set(t, [...(incoming.get(t) ?? []), f]);
  }

  const messageOf = (el: XmlElement): string | undefined => {
    const def = eventDefinition(el);
    if (def?.localName === 'messageEventDefinition') return messageName.get(attr(def, 'messageRef') ?? '');
    if (el.localName === 'receiveTask') return messageName.get(attr(el, 'messageRef') ?? '');
    return undefined;
  };

  // ——— sessions ———
  const sessions: BpmnSession[] = [];
  for (const task of elements.filter((e) => e.type === 'serviceTask')) {
    const el = byId.get(task.id)!;
    const worker = taskType(el);
    if (!worker || !SESSION_WORKERS[worker]) continue;
    // Sous-processus le plus proche qui contient aussi des messages de statut.
    const owner = [...task.scope].reverse().find((sp) =>
      descendants(byId.get(sp)!, 'intermediateCatchEvent')
        .concat(descendants(byId.get(sp)!, 'receiveTask'))
        .some((c) => SESSION_MESSAGES[messageOf(c) ?? ''] !== undefined),
    );
    if (!owner) continue;
    const ownerEl = byId.get(owner)!;
    const statuses = new Set<SessionStatus>();
    for (const c of [...descendants(ownerEl, 'intermediateCatchEvent'), ...descendants(ownerEl, 'receiveTask')]) {
      const s = SESSION_MESSAGES[messageOf(c) ?? ''];
      if (s) statuses.add(s);
    }
    const exits: SessionExit[] = [];
    for (const end of descendants(ownerEl, 'endEvent')) {
      const id = attr(end, 'id')!;
      if (scopeOf.get(id)?.at(-1) !== owner) continue; // fin d'un sous-processus imbriqué
      const def = eventDefinition(end);
      const name = attr(end, 'name');
      const base = { elementId: id, ...(name ? { name } : {}) };
      if (def?.localName === 'errorEventDefinition') {
        exits.push({ ...base, kind: 'error', code: errorCode.get(attr(def, 'errorRef') ?? '') ?? '' });
      } else if (def?.localName === 'escalationEventDefinition') {
        exits.push({ ...base, kind: 'escalation', code: escalationCode.get(attr(def, 'escalationRef') ?? '') ?? '' });
      } else exits.push({ ...base, kind: 'end' });
    }
    for (const b of elements.filter((e) => e.type === 'boundaryEvent')) {
      const bel = byId.get(b.id)!;
      const def = eventDefinition(bel);
      if (attr(bel, 'attachedToRef') !== owner || def?.localName !== 'errorEventDefinition') continue;
      exits.push({ elementId: b.id, kind: 'caught-error', code: errorCode.get(attr(def, 'errorRef') ?? '') ?? '', ...(b.name ? { name: b.name } : {}) });
    }
    const expr = inputs(el).sessionName;
    const names = expr !== undefined ? feelStrings(evaluateFeel(expr)) : null;
    const ownerName = attr(ownerEl, 'name');
    sessions.push({
      id: owner,
      ...(ownerName ? { name: ownerName } : {}),
      workerTaskId: task.id,
      worker,
      sessionName: names && names.length === 1 ? names[0]! : null,
      ...(expr !== undefined ? { sessionNameExpression: expr } : {}),
      statuses: SESSION_STATUSES.filter((s) => statuses.has(s)),
      exits,
      scope: scopeOf.get(owner) ?? [],
    });
  }

  // ——— branches (flux sortants des passerelles exclusives / inclusives) ———
  const branches: BpmnBranch[] = [];
  for (const g of elements.filter((e) => e.type === 'exclusiveGateway' || e.type === 'inclusiveGateway')) {
    const gel = byId.get(g.id)!;
    const out = flows.filter((f) => attr(f, 'sourceRef') === g.id);
    if (out.length < 2) continue; // passerelle de jonction
    for (const f of out) {
      const flowId = attr(f, 'id')!;
      const cond = child(f, 'conditionExpression')?.textContent?.trim();
      const name = attr(f, 'name');
      branches.push({
        key: `${g.scope.at(-1) ?? processId}/${flowId}`,
        flowId,
        gatewayId: g.id,
        ...(name ? { name } : {}),
        ...(cond ? { condition: cond } : {}),
        isDefault: attr(gel, 'default') === flowId,
        scope: g.scope,
      });
    }
  }
  const branchByFlow = new Map(branches.map((b) => [b.flowId, b.key]));

  // ——— décisions back-office ———
  const decisions: BpmnDecision[] = [];
  for (const e of elements.filter((x) => x.type === 'intermediateCatchEvent' || x.type === 'receiveTask' || x.type === 'boundaryEvent')) {
    const msg = messageOf(byId.get(e.id)!);
    const kind = msg ? DECISION_MESSAGES[msg] : undefined;
    if (msg && kind) decisions.push({ elementId: e.id, message: msg, kind, scope: e.scope });
  }
  const decisionIds = new Set(decisions.map((d) => d.elementId));

  /** Remonte les flux entrants : minuterie > décision > flux normal. */
  const triggerOf = (id: string): { trigger: EmailTrigger; via: string[] } => {
    const seen = new Set<string>();
    const via = new Set<string>();
    let found: EmailTrigger = 'flow';
    const rank: Record<EmailTrigger, number> = { flow: 0, decision: 1, timer: 2 };
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const el = byId.get(cur);
      if (el && cur !== id) {
        const def = eventDefinition(el);
        let t: EmailTrigger | undefined;
        if (def?.localName === 'timerEventDefinition') t = 'timer';
        else if (decisionIds.has(cur)) t = 'decision';
        if (t) {
          if (rank[t] > rank[found]) found = t;
          continue; // on s'arrête au premier événement déclencheur de chaque chemin
        }
      }
      for (const f of incoming.get(cur) ?? []) {
        const fid = attr(f, 'id')!;
        const b = branchByFlow.get(fid);
        if (b) via.add(b);
        queue.push(attr(f, 'sourceRef') ?? '');
      }
    }
    return { trigger: found, via: [...via] };
  };

  // ——— e-mails ———
  const emails: BpmnEmail[] = [];
  for (const task of elements.filter((e) => e.type === 'serviceTask' || e.type === 'sendTask')) {
    const el = byId.get(task.id)!;
    const worker = taskType(el);
    const version = worker ? EMAIL_WORKERS[worker] : undefined;
    if (!worker || !version) continue;
    const io = inputs(el);
    const evaluated: Record<string, FeelValue> = Object.fromEntries(Object.entries(io).map(([k, v]) => [k, evaluateFeel(v)]));

    let templateValue: FeelValue | undefined = evaluated.template;
    if (version === 'v4') {
      const payload = evaluated.payload;
      templateValue = payload?.kind === 'context' ? payload.entries.template : undefined;
    }
    const templates = feelStrings(templateValue);

    const subjects: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(evaluated)) {
      const m = /^subject_([a-z]{2}(?:-[A-Z]{2})?)$/.exec(k);
      const s = feelStrings(v);
      if (m && s) subjects[m[1]!] = s;
    }
    const subject = evaluated.subject;
    if (subject?.kind === 'context') {
      for (const [loc, v] of Object.entries(subject.entries)) {
        const s = feelStrings(v);
        if (s) subjects[loc] = s;
      }
    } else {
      const s = feelStrings(subject);
      if (s) subjects['*'] = s;
    }

    const locale = feelStrings(evaluated.locale);
    const folderRules: FolderRule[] = [];
    for (const key of ['folder', 'templateFolder', 'range'] as const) {
      const expr = io[key];
      if (expr === undefined) continue;
      const v = evaluated[key];
      const folders = v?.kind === 'values' && v.values.every((x) => typeof x === 'string' || x === null) ? (v.values as (string | null)[]) : null;
      folderRules.push({ input: key, expression: expr, variables: feelNames(expr), folders });
    }

    const { trigger, via } = triggerOf(task.id);
    emails.push({
      taskId: task.id,
      ...(task.name ? { taskName: task.name } : {}),
      worker,
      workerVersion: version,
      template: templates && templates.length === 1 ? templates[0]! : null,
      trigger,
      via,
      subjects,
      ...(locale && locale.length === 1 ? { fixedLocale: locale[0]! } : {}),
      folderRules,
      scope: task.scope,
    });
  }

  const processName = attr(process, 'name');
  return { processId, ...(processName ? { processName } : {}), elements, sessions, emails, decisions, branches };
}
