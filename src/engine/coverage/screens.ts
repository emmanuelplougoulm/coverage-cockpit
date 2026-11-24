import type { Ambiguity, CaptureRef, Cell, SessionCoverage, TestRef } from '../../core/coverage';
import type { JourneyConfig } from '../../core/journey';
import { JOURNEY_GROUP, type FrontState } from '../parsers/front';
import type { ScannedTest, StepHit } from '../parsers/scanTests';
import {
  channelOf,
  distinctiveWords,
  markerStateCandidates,
  methodCandidates,
  ref,
  shotsResolver,
  stepCandidates,
  suffixMessages,
  testResolver,
  type ResolveContext,
} from './resolve';
import { testRef } from './tests';

/** Ce qu'un test atteint et capture, une fois les coups résolus. */
export interface TestReach {
  reached: Set<string>;
  /** État capturé → nom de la capture (null si illisible). */
  captured: Map<string, string | null>;
  ambiguous: { marker: string; candidates: string[] }[];
}

/** Résout tous les coups d'un test (§6, étapes 1 à 6). Pure. */
export function resolveTest(t: ScannedTest, ctx: ResolveContext, inScope: (r: string) => boolean): TestReach {
  const reached = new Set<string>();
  const captured = new Map<string, string | null>();
  const ambiguous: TestReach['ambiguous'] = [];
  const keep = (c: string[]) => c.filter(inScope);

  const hits: { marker: string; cands: string[] }[] = [
    ...t.steps.map((h) => ({ marker: h.className, cands: keep(stepCandidates(h, ctx)) })),
    ...t.markers.map((m) => ({ marker: m.kind === 'id' ? `#${m.value}` : `.${m.value}`, cands: keep(markerStateCandidates(m, ctx)) })),
    ...t.methods.map((m) => ({ marker: m, cands: keep(methodCandidates(m, ctx)) })),
  ];
  const sure = new Set(hits.filter((h) => h.cands.length === 1).map((h) => h.cands[0]!));
  const channel = channelOf(sure, ctx.config.nominalPaths);

  const settle = (cands: string[]): string[] => (cands.length > 1 ? testResolver(cands, sure, channel) : cands);
  for (const h of hits) {
    const c = settle(h.cands);
    if (c.length === 1) reached.add(c[0]!);
    else if (c.length > 1) ambiguous.push({ marker: h.marker, candidates: c });
  }

  const pageStates = (page: StepHit[]): string[] => [...new Set(page.flatMap((h) => settle(keep(stepCandidates(h, ctx)))))];
  const labels = ctx.config.sessions ?? {};
  const screenShots = t.screenshots.filter((s) => s.call !== 'validateEmailUI');
  for (const shot of screenShots) {
    const page = shot.page.length ? shot.page : (shot.trail[0] ?? []);
    if (!page.length) continue;
    let cands = pageStates(page);
    if (cands.length > 1) {
      const before = shot.page.length ? shot.trail[0] : shot.trail[1];
      const trailStates = before ? pageStates(before) : [];
      const trailGroup = trailStates.length === 1 ? trailStates[0]!.slice(0, trailStates[0]!.indexOf('.')) : null;
      cands = shotsResolver(cands, distinctiveWords(shot, screenShots), trailGroup, labels);
    }
    const label = `${page.map((h) => h.className).join(' ')}${shot.suffix ? ` [${shot.suffix}]` : ''}`;
    const messages = suffixMessages(shot.suffix, cands, ctx.states).filter(inScope);
    if (messages.length === 1) {
      // Le suffixe nomme un message : il est couvert, la page n'est que traversée.
      captured.set(messages[0]!, shot.name);
      reached.add(messages[0]!);
      cands.forEach((c) => reached.add(c));
    } else if (messages.length > 1) {
      ambiguous.push({ marker: label, candidates: messages });
      cands.forEach((c) => reached.add(c));
    } else if (cands.length === 1) {
      captured.set(cands[0]!, shot.name);
      reached.add(cands[0]!);
    } else if (cands.length > 1) {
      ambiguous.push({ marker: label, candidates: cands });
    }
  }
  return { reached, captured, ambiguous };
}

export interface ScreensResult {
  sessions: SessionCoverage[];
  ambiguous: Ambiguity[];
  excluded: { id: string; reason: string }[];
}

/**
 * Cellules état × langue. `perTest` donne, pour chaque test rattaché, ses
 * langues et ce qu'il atteint ; un test de langue inconnue n'y figure pas.
 */
export function computeScreens(
  states: FrontState[],
  config: JourneyConfig,
  perTest: { test: ScannedTest; locales: string[]; reach: TestReach }[],
): ScreensResult {
  const excludedGroups = new Set(config.excludedGroups);
  const excludedStates = new Set(config.excludedStates);
  const excluded: ScreensResult['excluded'] = [];
  const order = [...Object.keys(config.sessions), JOURNEY_GROUP];
  const label = (g: string) => config.sessions[g] ?? (g === JOURNEY_GROUP ? 'Parcours' : g);

  const sessions: SessionCoverage[] = [];
  for (const group of order) {
    const own = states.filter((s) => s.group === group);
    if (excludedGroups.has(group)) {
      if (own.length) excluded.push({ id: group, reason: 'groupe hors périmètre (config)' });
      continue;
    }
    const inScope = own.filter((s) => {
      if (!excludedStates.has(ref(s))) return true;
      excluded.push({ id: ref(s), reason: 'état hors périmètre (config)' });
      return false;
    });
    if (!inScope.length) continue;
    sessions.push({
      group,
      label: label(group),
      states: inScope.map((s) => {
        const r = ref(s);
        const byLocale: Record<string, Cell> = {};
        for (const loc of config.locales) {
          const tests: TestRef[] = [];
          const capturedBy: CaptureRef[] = [];
          for (const p of perTest) {
            if (!p.locales.includes(loc)) continue;
            if (p.reach.reached.has(r)) tests.push(testRef(p.test));
            if (p.reach.captured.has(r)) {
              const shot = p.reach.captured.get(r);
              capturedBy.push({ ...testRef(p.test), ...(shot ? { shot } : {}) });
            }
          }
          byLocale[loc] = { status: capturedBy.length ? 'covered' : tests.length ? 'traversed' : 'missing', tests, capturedBy };
        }
        return {
          group: s.group,
          key: s.key,
          kind: s.kind,
          ...(s.stepName !== undefined ? { stepName: s.stepName } : {}),
          textLocales: s.locales,
          byLocale,
        };
      }),
    });
  }
  const unknownGroups = [...new Set(states.map((s) => s.group))].filter((g) => !order.includes(g));
  for (const g of unknownGroups) excluded.push({ id: g, reason: 'groupe absent de config.sessions' });

  // Ambiguïtés regroupées par marqueur + candidats.
  const amb = new Map<string, Ambiguity>();
  for (const p of perTest) {
    for (const a of p.reach.ambiguous) {
      const key = `${a.marker}|${a.candidates.join(',')}`;
      const entry = amb.get(key) ?? { marker: a.marker, candidates: a.candidates, tests: [] };
      if (!entry.tests.some((x) => x.id === p.test.fullTitle)) entry.tests.push(testRef(p.test));
      amb.set(key, entry);
    }
  }
  return { sessions, ambiguous: [...amb.values()], excluded };
}
