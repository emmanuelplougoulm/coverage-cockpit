import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';

/**
 * Mise en page minimale d'un BPMN sans DI, pour l'afficher : de gauche à
 * droite, par couches (plus long chemin depuis les débuts), sous-processus
 * ouverts avec leur contenu, événements frontières sur le bord bas de leur
 * hôte. Lecture seule : on renvoie une copie du XML avec un BPMNDiagram ajouté.
 */

const NODE = new Set([
  'task', 'serviceTask', 'userTask', 'sendTask', 'receiveTask', 'scriptTask', 'businessRuleTask', 'callActivity', 'subProcess',
  'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent',
  'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway',
]);
const GAP_X = 50;
const GAP_Y = 36;
const PAD = 30;
const HEADER = 24;

interface Box { x: number; y: number; w: number; h: number }
interface Laid { boxes: Map<string, Box>; w: number; h: number }

const kids = (el: XmlElement): XmlElement[] =>
  Array.from(el.childNodes as unknown as ArrayLike<{ nodeType: number }>).filter((n) => n.nodeType === 1) as unknown as XmlElement[];

function size(el: XmlElement, inner: Laid | null): { w: number; h: number } {
  const t = el.localName ?? '';
  if (t.endsWith('Event')) return { w: 36, h: 36 };
  if (t.endsWith('Gateway')) return { w: 50, h: 50 };
  if (t === 'subProcess' && inner) return { w: Math.max(160, inner.w + 2 * PAD), h: inner.h + 2 * PAD + HEADER };
  return { w: 100, h: 80 };
}

/** Place le contenu d'un conteneur (processus ou sous-processus) en coordonnées relatives. */
function layoutContainer(container: XmlElement): Laid {
  const all = kids(container);
  const nodes = all.filter((c) => NODE.has(c.localName ?? ''));
  const ids = new Set(nodes.map((n) => n.getAttribute('id')!));
  const boundary = all.filter((c) => c.localName === 'boundaryEvent');
  const hostOf = new Map(boundary.map((b) => [b.getAttribute('id')!, b.getAttribute('attachedToRef')!]));
  // Flux principal d'abord, flux partant d'un événement frontière ensuite : la ligne du haut reste le chemin normal.
  const flows = all
    .filter((c) => c.localName === 'sequenceFlow')
    .map((f) => {
      const src = f.getAttribute('sourceRef')!;
      return { src: hostOf.get(src) ?? src, tgt: f.getAttribute('targetRef')!, fromBoundary: hostOf.has(src) };
    })
    .sort((a, b) => Number(a.fromBoundary) - Number(b.fromBoundary));
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>([...ids].map((i) => [i, 0]));
  for (const f of flows) {
    if (!ids.has(f.src) || !ids.has(f.tgt)) continue;
    out.set(f.src, [...(out.get(f.src) ?? []), f.tgt]);
    indeg.set(f.tgt, (indeg.get(f.tgt) ?? 0) + 1);
  }

  // Couches : plus long chemin, arêtes retour ignorées (DFS).
  const rank = new Map<string, number>();
  const order: string[] = [];
  const onStack = new Set<string>();
  const visit = (id: string, r: number) => {
    if (onStack.has(id)) return;
    if ((rank.get(id) ?? -1) >= r) return;
    if (!rank.has(id)) order.push(id);
    rank.set(id, r);
    onStack.add(id);
    for (const t of out.get(id) ?? []) visit(t, r + 1);
    onStack.delete(id);
  };
  const roots = [...ids].filter((i) => (indeg.get(i) ?? 0) === 0);
  for (const r of roots.length ? roots : [...ids].slice(0, 1)) visit(r, 0);
  for (const i of ids) if (!rank.has(i)) visit(i, 0);

  const inner = new Map<string, Laid>();
  const sizes = new Map<string, { w: number; h: number }>();
  for (const n of nodes) {
    const id = n.getAttribute('id')!;
    if (n.localName === 'subProcess') inner.set(id, layoutContainer(n));
    sizes.set(id, size(n, inner.get(id) ?? null));
  }

  const layers = new Map<number, string[]>();
  for (const id of order) layers.set(rank.get(id)!, [...(layers.get(rank.get(id)!) ?? []), id]);
  const maxRank = Math.max(0, ...layers.keys());
  const colW: number[] = [];
  const rowH: number[] = [];
  for (let r = 0; r <= maxRank; r++) {
    const col = layers.get(r) ?? [];
    colW[r] = Math.max(0, ...col.map((id) => sizes.get(id)!.w));
    col.forEach((id, i) => (rowH[i] = Math.max(rowH[i] ?? 0, sizes.get(id)!.h + (boundary.some((b) => hostOf.get(b.getAttribute('id')!) === id) ? 30 : 0))));
  }
  const colX: number[] = [];
  let x = 0;
  for (let r = 0; r <= maxRank; r++) {
    colX[r] = x;
    x += (colW[r] ?? 0) + GAP_X;
  }
  const rowY: number[] = [];
  let y = 0;
  for (let i = 0; i < rowH.length; i++) {
    rowY[i] = y;
    y += rowH[i]! + GAP_Y;
  }

  const boxes = new Map<string, Box>();
  for (const [r, col] of layers) {
    col.forEach((id, i) => {
      const s = sizes.get(id)!;
      const bx = colX[r]! + (colW[r]! - s.w) / 2;
      const by = rowY[i]! + (rowH[i]! - s.h) / 2;
      boxes.set(id, { x: bx, y: by, ...s });
      const sub = inner.get(id);
      if (sub) for (const [cid, cb] of sub.boxes) boxes.set(cid, { ...cb, x: cb.x + bx + PAD, y: cb.y + by + PAD + HEADER });
    });
  }
  // Événements frontières : sur le bord bas de l'hôte, de droite à gauche.
  const perHost = new Map<string, number>();
  for (const b of boundary) {
    const host = boxes.get(hostOf.get(b.getAttribute('id')!)!);
    if (!host) continue;
    const k = perHost.get(hostOf.get(b.getAttribute('id')!)!) ?? 0;
    perHost.set(hostOf.get(b.getAttribute('id')!)!, k + 1);
    boxes.set(b.getAttribute('id')!, { x: host.x + host.w - 54 - k * 44, y: host.y + host.h - 18, w: 36, h: 36 });
  }
  return { boxes, w: Math.max(0, x - GAP_X), h: Math.max(0, y - GAP_Y) };
}

function waypoints(s: Box, t: Box, fromBoundary: boolean): [number, number][] {
  if (fromBoundary) {
    const sx = s.x + s.w / 2;
    const sy = s.y + s.h;
    return [[sx, sy], [sx, t.y + t.h / 2], [t.x, t.y + t.h / 2]];
  }
  const sx = s.x + s.w;
  const sy = s.y + s.h / 2;
  const tx = t.x;
  const ty = t.y + t.h / 2;
  if (tx <= sx) {
    // Arête retour : passe sous les deux formes.
    const low = Math.max(s.y + s.h, t.y + t.h) + 20;
    return [[s.x + s.w / 2, s.y + s.h], [s.x + s.w / 2, low], [t.x + t.w / 2, low], [t.x + t.w / 2, t.y + t.h]];
  }
  if (Math.abs(sy - ty) < 1) return [[sx, sy], [tx, ty]];
  const mx = sx + Math.min(GAP_X / 2, (tx - sx) / 2);
  return [[sx, sy], [mx, sy], [mx, ty], [tx, ty]];
}

/** Ajoute un BPMNDiagram si le BPMN n'en a pas ; sinon renvoie le XML tel quel. */
export function withLayout(xml: string): { xml: string; generated: boolean } {
  if (/BPMNDiagram/.test(xml)) return { xml, generated: false };
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement as unknown as XmlElement;
  const process = kids(root).find((c) => c.localName === 'process');
  if (!process) return { xml, generated: false };
  const { boxes } = layoutContainer(process);
  const OX = 40;
  const OY = 40;
  const shapes: string[] = [];
  const edges: string[] = [];
  const walk = (el: XmlElement) => {
    for (const c of kids(el)) {
      const id = c.getAttribute('id');
      if (!id) continue;
      const b = boxes.get(id);
      if (b && (NODE.has(c.localName ?? '') || c.localName === 'boundaryEvent')) {
        shapes.push(`<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${c.localName === 'subProcess' ? ' isExpanded="true"' : ''}><dc:Bounds x="${Math.round(b.x + OX)}" y="${Math.round(b.y + OY)}" width="${b.w}" height="${b.h}" /></bpmndi:BPMNShape>`);
      }
      if (c.localName === 'sequenceFlow') {
        const src = c.getAttribute('sourceRef')!;
        const s = boxes.get(src);
        const t = boxes.get(c.getAttribute('targetRef')!);
        if (s && t) {
          const isBoundary = kids(el).some((k) => k.localName === 'boundaryEvent' && k.getAttribute('id') === src);
          const pts = waypoints(s, t, isBoundary).map(([x, y]) => `<di:waypoint x="${Math.round(x + OX)}" y="${Math.round(y + OY)}" />`).join('');
          edges.push(`<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${pts}</bpmndi:BPMNEdge>`);
        }
      }
      if (c.localName === 'subProcess') walk(c);
    }
  };
  walk(process);

  const prefix = root.prefix ? `${root.prefix}:` : '';
  const ns = [
    ['bpmndi', 'http://www.omg.org/spec/BPMN/20100524/DI'],
    ['dc', 'http://www.omg.org/spec/DD/20100524/DC'],
    ['di', 'http://www.omg.org/spec/DD/20100524/DI'],
  ].filter(([p]) => !root.getAttribute(`xmlns:${p}`)).map(([p, u]) => ` xmlns:${p}="${u}"`).join('');
  const diagram = `<bpmndi:BPMNDiagram id="cc_layout"><bpmndi:BPMNPlane id="cc_plane" bpmnElement="${process.getAttribute('id')}">${shapes.join('')}${edges.join('')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`;
  const openTag = new RegExp(`<${prefix}definitions\\b`);
  const closeTag = `</${prefix}definitions>`;
  const withNs = xml.replace(openTag, (m) => `${m}${ns}`);
  const i = withNs.lastIndexOf(closeTag);
  return { xml: `${withNs.slice(0, i)}${diagram}\n${withNs.slice(i)}`, generated: true };
}
