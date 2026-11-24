import type { JourneyConfig } from '../../core/journey';
import type { Hint, HintKind, Ticket } from '../../core/tickets';
import type { JiraFields } from './jira';

/**
 * Ticket → parcours (§9). Indices du plus fiable au moins fiable ; le premier
 * qui désigne UN SEUL parcours l'emporte, les autres s'affichent à côté.
 */

const ORDER: HintKind[] = ['bpmn-field', 'case-keys', 'description', 'title-bracket', 'taxonomy', 'epic'];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Nettoie le wiki markup Jira pour l'affichage (titres, gras, liens, blocs). */
export function wikiToText(s: string): string {
  return s
    .replace(/\{(code|noformat|quote|panel)(:[^}]*)?\}/g, '')
    .replace(/^h[1-6]\.\s*/gm, '')
    .replace(/\[([^|\]]+)\|[^\]]+\]/g, '$1')
    .replace(/[*_+]([^*_+\n]+)[*_+]/g, '$1')
    .replace(/\r/g, '')
    .trim();
}

/** Sprints : objets (API récente) ou chaînes « …Sprint@…[id=…,state=ACTIVE,name=…] » (Data Center). */
export function parseSprints(v: unknown): Ticket['sprints'] {
  const out: Ticket['sprints'] = [];
  for (const s of Array.isArray(v) ? v : v ? [v] : []) {
    if (typeof s === 'string') {
      const name = /name=([^,\]]+)/.exec(s)?.[1];
      const state = /state=([^,\]]+)/.exec(s)?.[1];
      if (name) out.push({ name, state: state ?? '' });
    } else if (s && typeof s === 'object') {
      const o = s as { name?: string; state?: string };
      if (o.name) out.push({ name: o.name, state: (o.state ?? '').toUpperCase() });
    }
  }
  return out;
}

const fieldText = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? ((v as { value?: string; name?: string }).value ?? (v as { name?: string }).name ?? null) : null;

export interface DeduceContext {
  journeys: JourneyConfig[];
  /** Clé de cas → parcours dont un test porte ce tag. */
  caseKeys: Map<string, Set<string>>;
  /** Epic → parcours (via les tickets de campagne). */
  epics: Map<string, Set<string>>;
}

export function deduceJourney(summary: string, description: string, fields: Record<string, unknown>, map: JiraFields, ctx: DeduceContext): Pick<Ticket, 'journey' | 'decidedBy' | 'hints' | 'divergent'> {
  const hints: Hint[] = [];
  const ids = ctx.journeys.map((j) => j.id);
  const byText = (text: string) => ctx.journeys.filter((j) => norm(text) === norm(j.id) || norm(j.label).includes(norm(text)) || norm(text).includes(norm(j.id))).map((j) => j.id);

  const bpmn = map.bpmn ? fieldText(fields[map.bpmn]) : null;
  if (bpmn) hints.push({ kind: 'bpmn-field', journeys: ids.filter((id) => norm(id) === norm(bpmn)), evidence: bpmn });

  const cases = [...new Set(`${summary}\n${description}`.match(/\b[A-Z][A-Z0-9]+-TC-\d+\b/g) ?? [])];
  if (cases.length) {
    const js = new Set(cases.flatMap((k) => [...(ctx.caseKeys.get(`@${k}`) ?? [])]));
    hints.push({ kind: 'case-keys', journeys: [...js], evidence: cases.join(', ') });
  }

  const inDesc = ids.filter((id) => description.includes(id));
  if (inDesc.length) hints.push({ kind: 'description', journeys: inDesc, evidence: inDesc.join(', ') });

  const bracket = /^\s*\[([^\]]+)\]/.exec(summary)?.[1];
  if (bracket) hints.push({ kind: 'title-bracket', journeys: byText(bracket), evidence: `[${bracket}]` });

  const tax = map.taxonomy ? fieldText(fields[map.taxonomy]) : null;
  if (tax) hints.push({ kind: 'taxonomy', journeys: byText(tax), evidence: tax });

  const epic = map.epic ? fieldText(fields[map.epic]) : null;
  if (epic) hints.push({ kind: 'epic', journeys: [...(ctx.epics.get(epic) ?? [])], evidence: epic });

  hints.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const decided = hints.find((h) => h.journeys.length === 1);
  const journey = decided?.journeys[0] ?? null;
  return {
    journey,
    decidedBy: decided?.kind ?? null,
    hints,
    divergent: !!journey && hints.some((h) => h.journeys.length === 1 && h.journeys[0] !== journey),
  };
}

export function toTicket(raw: unknown, baseUrl: string | null, map: JiraFields, ctx: DeduceContext): Ticket {
  const r = raw as { key: string; fields: Record<string, unknown> };
  const f = r.fields ?? {};
  const status = (f.status ?? {}) as { name?: string; statusCategory?: { key?: string } };
  const summary = String(f.summary ?? '');
  const description = wikiToText(String(f.description ?? ''));
  return {
    key: r.key,
    summary,
    description: description.slice(0, 2000),
    status: status.name ?? '',
    statusCategory: status.statusCategory?.key ?? '',
    type: ((f.issuetype ?? {}) as { name?: string }).name ?? '',
    sprints: map.sprint ? parseSprints(f[map.sprint]) : [],
    epic: map.epic ? fieldText(f[map.epic]) : null,
    url: baseUrl ? `${baseUrl.replace(/\/$/, '')}/browse/${r.key}` : null,
    ...deduceJourney(summary, String(f.description ?? ''), f, map, ctx),
  };
}
