import type { CaptureRef, Cell, CoverageView, NominalResolution, ReachStatus, TestRef } from './coverage';
import type { NominalPath } from './journey';

/**
 * Registre (§8) : une ligne = un scénario, ce qu'un test parcourt d'un trait,
 * rangé dans l'une des cinq familles. Fonctions pures.
 */

export type Family = 'nominal' | 'escalation' | 'alternative' | 'email' | 'technical';
export const FAMILIES: Family[] = ['nominal', 'escalation', 'alternative', 'email', 'technical'];
export const FAMILY_LABEL: Record<Family, string> = {
  nominal: 'Chemin nominal',
  escalation: "Escalades jusqu'au blocage",
  alternative: 'Branches alternatives',
  email: 'E-mails',
  technical: 'Erreurs techniques',
};

/** Écrans « écartés » : sortis du compte, avec leur raison (décision humaine). */
export type AsideMap = Record<string, { reason: string; at: string }>;

export interface StepCell {
  status: ReachStatus;
  tests: TestRef[];
  capture?: CaptureRef;
}

export interface ScenarioStep {
  /** "GROUP.KEY" ou "email:<gabarit>/<variante>". */
  ref: string;
  label: string;
  session: string;
  byLocale: Record<string, StepCell>;
  aside?: { reason: string; at: string };
}

export type ScenarioState = 'done' | 'partial' | 'todo' | 'aside';

export interface Scenario {
  id: string;
  family: Family;
  label: string;
  steps: ScenarioStep[];
  /** Une seule capture suffit (erreurs techniques de même texte). */
  anyOf?: boolean;
  locales: string[];
  tests: TestRef[];
  /** Cellules capturées / cellules comptées (hors écrans écartés). */
  done: number;
  total: number;
  state: ScenarioState;
  /** Chemin nominal d'origine (famille nominale). */
  path?: NominalPath;
}

export interface Register {
  scenarios: Scenario[];
  counts: Record<Family, { scenarios: number; done: number; total: number; states: Record<ScenarioState, number> }>;
  nominal: NominalResolution;
  /** Aucun chemin nominal connu : le registre propose de demander un smoke. */
  nominalUnknown: boolean;
}

const TECHNICAL = /internalError|serverError|technical|timeout|unavailable|maintenance|networkError/i;
const END = /blocked|noMoreAttempts|nomoreattempts|no_?retries|locked/i;
const ESCALATION = /retry|blocked|noMoreAttempts|nomoreattempts|no_?retries|expired|expiration|attempt|helperTextOnError|resend|liveness/i;

const groupOf = (r: string) => r.slice(0, r.indexOf('.'));
const RANK: Record<ReachStatus, number> = { missing: 0, traversed: 1, covered: 2 };
const better = (a: Cell | undefined, b: Cell | undefined): Cell | undefined => (!a ? b : !b ? a : RANK[b.status] > RANK[a.status] ? b : a);

/** Range chaque état en famille ; l'ordre des règles compte. */
export function familyOfState(ref: string, nominal: Set<string>, escalationEnds: string[] = []): Exclude<Family, 'email'> {
  const key = ref.slice(ref.indexOf('.') + 1);
  if (escalationEnds.includes(ref)) return 'escalation';
  if (nominal.has(ref)) return 'nominal';
  if (groupOf(ref) === 'JOURNEY' || TECHNICAL.test(key)) return 'technical';
  if (ESCALATION.test(key)) return 'escalation';
  return 'alternative';
}

function scenario(
  id: string,
  family: Family,
  label: string,
  steps: ScenarioStep[],
  extra: { anyOf?: boolean; path?: NominalPath } = {},
): Scenario {
  const counted = steps.filter((s) => !s.aside);
  const locales = [...new Set(steps.flatMap((s) => Object.keys(s.byLocale)))];
  let done = 0;
  let total = 0;
  let reached = 0;
  for (const loc of locales) {
    const cells = counted.map((s) => s.byLocale[loc]).filter((c): c is StepCell => !!c);
    if (extra.anyOf) {
      if (!cells.length) continue;
      total += 1;
      if (cells.some((c) => c.status === 'covered')) done += 1;
      if (cells.some((c) => c.status !== 'missing')) reached += 1;
    } else {
      total += cells.length;
      done += cells.filter((c) => c.status === 'covered').length;
      reached += cells.filter((c) => c.status !== 'missing').length;
    }
  }
  const tests = new Map<string, TestRef>();
  for (const s of steps) for (const c of Object.values(s.byLocale)) for (const t of c.tests) tests.set(t.id, t);
  const state: ScenarioState = !counted.length ? 'aside' : done === total && total > 0 ? 'done' : reached > 0 ? 'partial' : 'todo';
  return { id, family, label, steps, locales, tests: [...tests.values()], done, total, state, ...(extra.anyOf ? { anyOf: true } : {}), ...(extra.path ? { path: extra.path } : {}) };
}

const stepCell = (c: Cell): StepCell => ({ status: c.status, tests: c.tests, ...(c.capturedBy.find((x) => x.image) ?? c.capturedBy[0] ? { capture: (c.capturedBy.find((x) => x.image) ?? c.capturedBy[0])! } : {}) });

/**
 * Registre d'un parcours. `ui` donne les écrans ; les e-mails réunissent les
 * suites UI et workflow (un e-mail capturé par un test workflow compte ici).
 */
export function familiesOf(ui: CoverageView, aside: AsideMap = {}, workflow?: CoverageView): Register {
  const escalationEnds = ui.escalationEnds;
  const states = new Map<string, { label: string; session: string; kind: 'step' | 'message'; byLocale: Record<string, Cell> }>();
  for (const s of ui.sessions) for (const st of s.states) states.set(`${st.group}.${st.key}`, { label: st.key, session: s.label, kind: st.kind, byLocale: st.byLocale });
  const step = (ref: string): ScenarioStep | null => {
    const st = states.get(ref);
    if (!st) return null;
    const a = aside[ref];
    return { ref, label: st.label, session: st.session, byLocale: Object.fromEntries(Object.entries(st.byLocale).map(([l, c]) => [l, stepCell(c)])), ...(a ? { aside: a } : {}) };
  };

  const scenarios: Scenario[] = [];
  const paths = ui.nominal.paths;
  const nominal = new Set(paths.flatMap((p) => p.screens));

  // 1. Chemin nominal : un scénario par canal.
  for (const p of paths) {
    const steps = p.screens.map(step).filter((s): s is ScenarioStep => !!s);
    scenarios.push(scenario(`nominal:${p.id}`, 'nominal', p.label, steps, { path: p }));
  }

  // Rangement des autres états.
  const byFamily: Record<'escalation' | 'alternative' | 'technical', string[]> = { escalation: [], alternative: [], technical: [] };
  for (const ref of states.keys()) {
    const f = familyOfState(ref, nominal, escalationEnds);
    if (f !== 'nominal') byFamily[f].push(ref);
  }

  // 2. Escalades : message + nouvel essai + écran de fin d'une même session restent ensemble.
  const escBySession = new Map<string, string[]>();
  for (const ref of byFamily.escalation) escBySession.set(groupOf(ref), [...(escBySession.get(groupOf(ref)) ?? []), ref]);
  // Ordre de lecture : message, nouvel essai, puis écran de fin (blocage).
  const escRank = (r: string) => (states.get(r)?.kind === 'message' ? 0 : escalationEnds.includes(r) || END.test(r.split('.')[1] ?? '') ? 2 : 1);
  for (const [group, refs] of escBySession) {
    const steps = [...refs].sort((a, b) => escRank(a) - escRank(b)).map(step).filter((s): s is ScenarioStep => !!s);
    scenarios.push(scenario(`escalation:${group}`, 'escalation', `Escalade — ${steps[0]?.session ?? group}`, steps));
  }

  // 3. Branches alternatives : composantes connexes du graphe des cartes d'étapes.
  const alt = new Set(byFamily.alternative);
  const adj = new Map<string, Set<string>>();
  for (const t of ui.transitions) {
    for (const to of t.to) {
      if (!alt.has(t.from) || !alt.has(to)) continue;
      adj.set(t.from, (adj.get(t.from) ?? new Set()).add(to));
      adj.set(to, (adj.get(to) ?? new Set()).add(t.from));
    }
  }
  const seen = new Set<string>();
  for (const ref of byFamily.alternative) {
    if (seen.has(ref)) continue;
    const comp: string[] = [];
    const queue = [ref];
    while (queue.length) {
      const r = queue.shift()!;
      if (seen.has(r)) continue;
      seen.add(r);
      comp.push(r);
      queue.push(...(adj.get(r) ?? []));
    }
    const ordered = byFamily.alternative.filter((r) => comp.includes(r));
    const steps = ordered.map(step).filter((s): s is ScenarioStep => !!s);
    scenarios.push(scenario(`alternative:${ordered[0]}`, 'alternative', ordered.length > 1 ? `${steps[0]?.session} : ${ordered.map((r) => r.split('.')[1]).join(' → ')}` : `${steps[0]?.session} : ${steps[0]?.label}`, steps));
  }

  // 4. E-mails : chaque gabarit, par variante (marque / code) et par langue ; UI et workflow réunis.
  const wf = new Map((workflow?.emails ?? []).map((e) => [e.template, e]));
  for (const e of ui.emails) {
    const steps: ScenarioStep[] = e.variants.map((v) => {
      const other = wf.get(e.template)?.variants.find((x) => x.variant === v.variant);
      const byLocale: Record<string, StepCell> = {};
      for (const loc of Object.keys(v.byLocale)) {
        const c = better(v.byLocale[loc], other?.byLocale[loc]);
        const merged: Cell = c ? { ...c, tests: [...(v.byLocale[loc]?.tests ?? []), ...(other?.byLocale[loc]?.tests ?? [])], capturedBy: [...(v.byLocale[loc]?.capturedBy ?? []), ...(other?.byLocale[loc]?.capturedBy ?? [])] } : v.byLocale[loc]!;
        byLocale[loc] = stepCell(merged);
      }
      const ref = `email:${e.template}/${v.variant}`;
      const a = aside[ref];
      return { ref, label: v.variant, session: e.template, byLocale, ...(a ? { aside: a } : {}) };
    });
    scenarios.push(scenario(`email:${e.template}`, 'email', `${e.template}${e.missingTemplate ? ' (gabarit absent)' : ''}`, steps));
  }

  // 5. Erreurs techniques : une ligne par texte distinct ; une seule capture suffit.
  const byText = new Map<string, string[]>();
  for (const ref of byFamily.technical) {
    const text = ui.texts[ref] ?? ref;
    byText.set(text, [...(byText.get(text) ?? []), ref]);
  }
  for (const [text, refs] of byText) {
    const steps = refs.map(step).filter((s): s is ScenarioStep => !!s);
    scenarios.push(scenario(`technical:${refs[0]}`, 'technical', `« ${text} »`, steps, { anyOf: true }));
  }

  const counts = Object.fromEntries(
    FAMILIES.map((f) => {
      const list = scenarios.filter((s) => s.family === f);
      const st: Record<ScenarioState, number> = { done: 0, partial: 0, todo: 0, aside: 0 };
      list.forEach((s) => st[s.state]++);
      return [f, { scenarios: list.length, done: list.reduce((n, s) => n + s.done, 0), total: list.reduce((n, s) => n + s.total, 0), states: st }];
    }),
  ) as Register['counts'];

  return { scenarios, counts, nominal: ui.nominal, nominalUnknown: paths.length === 0 };
}

// ——— tags et smoke ———

/** Test nominal : le dernier de @HAPPY_PATH / @SAD_PATH (du describe extérieur à l'option du test) est @HAPPY_PATH. */
export function isNominalTest(tags: string[]): boolean {
  const last = [...tags].reverse().find((t) => t === '@HAPPY_PATH' || t === '@SAD_PATH');
  return last === '@HAPPY_PATH';
}

export interface SmokeCell {
  pathId: string;
  pathLabel: string;
  locale: string;
  status: 'done' | 'partial' | 'todo';
  /** Le smoke de la langue : test nominal qui capture le plus d'écrans du chemin. */
  test: TestRef | null;
  reached: number;
  captured: number;
  total: number;
  validated: boolean;
  /** Une validation existe mais pour un autre test : elle ne tient plus. */
  staleValidation: string | null;
}

/** Clé de validation manuelle : `<id du chemin>|<langue>`. */
export const smokeKey = (pathId: string, locale: string) => `${pathId}|${locale}`;

export function smokeOf(ui: CoverageView, validations: Record<string, string> = {}): SmokeCell[] {
  const cellOf = new Map<string, Record<string, Cell>>();
  for (const s of ui.sessions) for (const st of s.states) cellOf.set(`${st.group}.${st.key}`, st.byLocale);
  const nominalTests = ui.tests.filter((t) => isNominalTest(ui.testTags[t.id] ?? []));
  // Canal d'un test : le chemin dont il parcourt la plus grande part (égalité : tous).
  const reachedBy = new Map<string, Set<string>>();
  for (const [ref, byLocale] of cellOf) for (const c of Object.values(byLocale)) for (const t of c.tests) reachedBy.set(t.id, (reachedBy.get(t.id) ?? new Set()).add(ref));
  const share = (t: TestRef, p: NominalPath) => p.screens.filter((r) => reachedBy.get(t.id)?.has(r)).length / Math.max(1, p.screens.length);
  const onPath = (t: TestRef, p: NominalPath) => share(t, p) >= Math.max(...ui.nominal.paths.map((q) => share(t, q)));
  const out: SmokeCell[] = [];
  for (const p of ui.nominal.paths) {
    const screens = p.screens.filter((r) => cellOf.has(r));
    for (const locale of ui.locales) {
      let best: { test: TestRef; reached: number; captured: number } | null = null;
      for (const t of nominalTests.filter((x) => onPath(x, p))) {
        let reached = 0;
        let captured = 0;
        for (const r of screens) {
          const c = cellOf.get(r)?.[locale];
          if (c?.tests.some((x) => x.id === t.id)) reached++;
          if (c?.capturedBy.some((x) => x.id === t.id)) captured++;
        }
        if (!reached) continue;
        if (!best || captured > best.captured || (captured === best.captured && reached > best.reached)) best = { test: t, reached, captured };
      }
      const key = smokeKey(p.id, locale);
      const validatedFor = validations[key];
      out.push({
        pathId: p.id,
        pathLabel: p.label,
        locale,
        status: best && best.captured === screens.length && screens.length > 0 ? 'done' : best ? 'partial' : 'todo',
        test: best?.test ?? null,
        reached: best?.reached ?? 0,
        captured: best?.captured ?? 0,
        total: screens.length,
        validated: !!best && validatedFor === best.test.id,
        staleValidation: validatedFor && validatedFor !== best?.test.id ? validatedFor : null,
      });
    }
  }
  return out;
}

export interface TagIssue {
  test: TestRef;
  issue: string;
}

/**
 * Règle de tags (§8) : un test UI qui suit un chemin nominal doit être tagué
 * @HAPPY_PATH (même si le chemin vient d'un @P1) ; un test tagué qui ne suit
 * aucun chemin est signalé.
 */
export function tagIssues(ui: CoverageView): TagIssue[] {
  const paths = ui.nominal.paths;
  if (!paths.length) return [];
  const reachedBy = new Map<string, Set<string>>();
  for (const s of ui.sessions) {
    for (const st of s.states) {
      for (const c of Object.values(st.byLocale)) {
        for (const t of c.tests) reachedBy.set(t.id, (reachedBy.get(t.id) ?? new Set()).add(`${st.group}.${st.key}`));
      }
    }
  }
  const out: TagIssue[] = [];
  for (const t of ui.tests) {
    const reached = reachedBy.get(t.id) ?? new Set();
    const best = Math.max(0, ...paths.map((p) => p.screens.filter((r) => reached.has(r)).length / Math.max(1, p.screens.length)));
    const tagged = isNominalTest(ui.testTags[t.id] ?? []);
    if (!tagged && best >= 0.5) out.push({ test: t, issue: `suit ${Math.round(best * 100)} % d'un chemin nominal : à taguer @HAPPY_PATH` });
    if (tagged && reached.size > 0 && best < 0.2) out.push({ test: t, issue: 'tagué @HAPPY_PATH mais ne suit aucun chemin nominal' });
  }
  return out;
}

// ——— demande « Nouveau test » ———

/** Rédige la demande « Nouveau test » / « Compléter » d'un scénario (remise telle quelle à l'IA au jalon 9). */
export function scenarioRequest(s: Scenario, journey: { id: string; label: string }): string {
  const counted = s.steps.filter((x) => !x.aside);
  const missing = (loc: string) => counted.filter((x) => x.byLocale[loc] && x.byLocale[loc]!.status !== 'covered').map((x) => x.ref);
  const existing = s.tests.length ? 'Compléter' : 'Nouveau test';
  const lines = [
    `${existing} — ${FAMILY_LABEL[s.family]} : ${s.label}`,
    `Parcours : ${journey.label} (${journey.id})`,
    s.anyOf
      ? `Provoquer l'un de ces états (une seule capture suffit) : ${counted.map((x) => x.ref).join(' | ')}`
      : `Écrans dans l'ordre : ${counted.map((x) => x.ref).join(' → ')}`,
    `Langues : ${s.locales.join(', ')} (un cas piloté par données par langue)`,
    ...s.locales.filter((l) => missing(l).length).map((l) => `À capturer en ${l} : ${missing(l).join(', ')} (validateUI() sur chaque page objet, avant d'agir)`),
  ];
  if (s.path) lines.push(`Point de départ : ${s.path.setup}${s.path.from ? ` (cas proche : ${s.path.from})` : ''}`);
  if (s.tests.length) lines.push(`Tests existants à compléter d'abord : ${s.tests.map((t) => `${t.file}:${t.line}`).join(', ')}`);
  if (s.family === 'nominal') lines.push('Taguer le test @HAPPY_PATH.');
  if (s.family === 'technical') lines.push("Provoquer l'erreur sans mock : réseau coupé, caméra refusée, épuisement réel — jamais page.route.");
  if (s.family === 'email') lines.push("Chercher l'e-mail par son objet, puis le capturer (EmailViewer + validateEmailUI).");
  return lines.join('\n');
}

/** Demande de repli quand aucun chemin nominal n'est connu : un smoke à construire avec l'IA. */
export function smokeRequest(journey: { id: string; label: string }, locales: string[]): string {
  return [
    `Nouveau test — smoke du parcours ${journey.label} (${journey.id})`,
    'Chemin nominal inconnu : parcourir le parcours de bout en bout par le chemin le plus probable, en capturant chaque écran.',
    `Langues : ${locales.join(', ')} (un cas piloté par données par langue)`,
    'Taguer le test @HAPPY_PATH ; proposer ensuite le chemin trouvé pour la config (nominalPaths).',
  ].join('\n');
}
