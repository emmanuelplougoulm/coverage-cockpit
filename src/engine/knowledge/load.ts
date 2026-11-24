import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Bricks, ControlPattern, Decision, DecisionKind, Expectation, Knowledge, Layer } from '../../core/knowledge';

/**
 * Lecture et validation de `knowledge/*.yaml`. Une erreur nomme le fichier et
 * l'entrée fautive : la connaissance est une décision humaine, on ne la devine pas.
 */

export class KnowledgeError extends Error {}

const KINDS: DecisionKind[] = ['branch', 'excludeState', 'excludeTemplate', 'excludeBpmnStep', 'technicalStep'];
const LAYERS: Layer[] = ['MO', 'Client', 'Document', 'API', 'E-mail', 'Test'];
const CONF = ['haute', 'moyenne', 'basse'];

function regex(file: string, where: string, src: unknown): string {
  if (typeof src !== 'string' || !src) throw new KnowledgeError(`${file} : ${where} — regex attendue`);
  try {
    new RegExp(src);
  } catch {
    throw new KnowledgeError(`${file} : ${where} — regex invalide « ${src} »`);
  }
  return src;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

export function parseDecisions(text: string, file = 'decisions.yaml'): Decision[] {
  const raw = arr(parse(text));
  const ids = new Set<string>();
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const where = `entrée ${i + 1}${typeof o.id === 'string' ? ` (${o.id})` : ''}`;
    if (typeof o.id !== 'string' || !o.id) throw new KnowledgeError(`${file} : ${where} — id manquant`);
    if (ids.has(o.id)) throw new KnowledgeError(`${file} : ${where} — id en double`);
    ids.add(o.id);
    if (!KINDS.includes(o.kind as DecisionKind)) throw new KnowledgeError(`${file} : ${where} — genre inconnu ${String(o.kind)}`);
    if (typeof o.why !== 'string' || !o.why.trim()) throw new KnowledgeError(`${file} : ${where} — « why » obligatoire`);
    const d: Decision = { id: o.id, kind: o.kind as DecisionKind, why: o.why, journeys: strs(o.journeys), exceptions: strs(o.exceptions) };
    if (d.kind === 'branch') {
      d.event = regex(file, `${where}.event`, o.event);
      if (o.subprocess !== undefined) d.subprocess = regex(file, `${where}.subprocess`, o.subprocess);
      const links = o.links;
      if (links !== 'none' && !(typeof links === 'string' && /^(email|step):/.test(links))) {
        throw new KnowledgeError(`${file} : ${where}.links — none, email:<regex> ou step:<regex>`);
      }
      if (links !== 'none') regex(file, `${where}.links`, links.slice(links.indexOf(':') + 1));
      d.links = links;
    } else {
      d.pattern = regex(file, `${where}.pattern`, o.pattern);
    }
    return d;
  });
}

export function parseBricks(text: string, file = 'business-bricks.yaml'): Bricks {
  const o = (parse(text) ?? {}) as Record<string, unknown>;
  const bricks = arr(o.bricks).map((b, i) => {
    const x = (b ?? {}) as Record<string, unknown>;
    if (typeof x.id !== 'string' || typeof x.label !== 'string') throw new KnowledgeError(`${file} : brique ${i + 1} — id et label attendus`);
    return { id: x.id, label: x.label };
  });
  const known = new Set(bricks.map((b) => b.id));
  const rules = (key: string) =>
    arr(o[key]).map((r, i) => {
      const x = (r ?? {}) as Record<string, unknown>;
      const where = `${key}[${i + 1}]`;
      if (!known.has(x.brick as string)) throw new KnowledgeError(`${file} : ${where} — brique inconnue ${String(x.brick)}`);
      if (!CONF.includes(x.confidence as string)) throw new KnowledgeError(`${file} : ${where} — confiance haute | moyenne | basse`);
      return { match: regex(file, where, x.match), brick: x.brick as string, confidence: x.confidence as 'haute', ...(typeof x.note === 'string' ? { note: x.note } : {}) };
    });
  return { bricks, front: rules('front'), states: rules('states'), subprocesses: rules('subprocesses') };
}

export function parsePatterns(text: string, bricks: Bricks, file = 'control-patterns.yaml'): Record<string, ControlPattern> {
  const o = ((parse(text) ?? {}) as Record<string, unknown>).patterns as Record<string, unknown> | undefined;
  const known = new Set(bricks.bricks.map((b) => b.id));
  const out: Record<string, ControlPattern> = {};
  for (const [brick, p] of Object.entries(o ?? {})) {
    if (!known.has(brick)) throw new KnowledgeError(`${file} : brique inconnue ${brick}`);
    const x = (p ?? {}) as Record<string, unknown>;
    out[brick] = {
      steps: strs(x.steps).map((s, i) => regex(file, `${brick}.steps[${i + 1}]`, s)),
      modes: strs(x.modes),
      intentions: arr(x.intentions).map((it, i) => {
        const y = (it ?? {}) as Record<string, unknown>;
        const where = `${brick}.intentions[${i + 1}]`;
        if (typeof y.id !== 'string' || typeof y.label !== 'string') throw new KnowledgeError(`${file} : ${where} — id et label attendus`);
        if (!LAYERS.includes(y.layer as Layer)) throw new KnowledgeError(`${file} : ${where} — couche inconnue ${String(y.layer)}`);
        return { id: y.id, label: y.label, checks: strs(y.checks), layer: y.layer as Layer, core: y.core === true };
      }),
    };
  }
  return out;
}

export function parseExpectations(text: string, patterns: Record<string, ControlPattern>, file = 'bpmn-expectations.yaml'): Expectation[] {
  const intentions = new Set(Object.values(patterns).flatMap((p) => p.intentions.map((i) => i.id)));
  return arr(((parse(text) ?? {}) as Record<string, unknown>).facts).map((f, i) => {
    const x = (f ?? {}) as Record<string, unknown>;
    const where = `facts[${i + 1}]`;
    if (!['session', 'email', 'branch'].includes(x.kind as string)) throw new KnowledgeError(`${file} : ${where} — kind session | email | branch`);
    const expect = strs(x.expect);
    for (const e of expect) if (!intentions.has(e)) throw new KnowledgeError(`${file} : ${where} — intention inconnue ${e}`);
    return { kind: x.kind as Expectation['kind'], name: regex(file, where, x.name), expect };
  });
}

/** Charge les quatre fichiers ; un fichier absent vaut une connaissance vide. */
export function loadKnowledge(dir: string): Knowledge {
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  const bricks = parseBricks(read('business-bricks.yaml') || 'bricks: []');
  const patterns = parsePatterns(read('control-patterns.yaml'), bricks);
  return {
    decisions: parseDecisions(read('decisions.yaml')),
    bricks,
    patterns,
    expectations: parseExpectations(read('bpmn-expectations.yaml'), patterns),
  };
}
