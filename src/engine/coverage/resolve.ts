import type { JourneyConfig, NominalPath } from '../../core/journey';
import { JOURNEY_GROUP, markerCandidates, SDK_CLASS_MARKERS, type FrontState, type Marker } from '../parsers/front';
import type { ScreenshotHit, StepHit } from '../parsers/scanTests';

/**
 * Résolution d'un « coup » (classe d'étape, marqueur, méthode) vers des états
 * "GROUP.KEY" (§6). Fonctions pures. Plusieurs candidats restants = ambigu :
 * on ne choisit jamais au hasard.
 */

export const ref = (s: Pick<FrontState, 'group' | 'key'>): string => `${s.group}.${s.key}`;
const groupOf = (r: string): string => r.slice(0, r.indexOf('.'));

/** Suffixe de version seul : `2`, `2_1`, `_1`, ou rien. */
const VERSION_SUFFIX = /^\d*(_\d+)?$/;

/** Suffixes de capture qui désignent plusieurs messages possibles. */
export const MESSAGE_SUFFIX_ALIASES: Record<string, string[]> = {
  'wrong-otp': ['helperTextOnError', 'codeHelperTextOnError'],
};

export interface ResolveContext {
  states: FrontState[];
  config: Pick<JourneyConfig, 'stepAliases' | 'methodStates' | 'nominalPaths'> & { sessions?: Record<string, string> };
}

/** Candidats d'une classe d'étape, étapes 1 à 4 de §6. */
export function stepCandidates(hit: StepHit, ctx: ResolveContext): string[] {
  const aliases = ctx.config.stepAliases ?? {};
  const alias = aliases[`step-${hit.step}`] ?? aliases[hit.step];
  if (alias) return [alias];

  // Classe SDK accolée (`step-internalError journey-error`) : la classe décide.
  for (const c of hit.className.split(/\s+/)) {
    const sdk = SDK_CLASS_MARKERS[c];
    if (sdk) return [sdk];
  }

  const steps = ctx.states.filter((s) => s.kind === 'step' && s.stepName !== undefined);
  const exact = steps.filter((s) => s.stepName === hit.step).map(ref);
  if (exact.length || hit.match === 'exact') {
    if (exact.length) return exact;
  } else {
    const versioned = steps.filter((s) => s.stepName!.startsWith(hit.step) && VERSION_SUFFIX.test(s.stepName!.slice(hit.step.length))).map(ref);
    if (versioned.length) return versioned;
  }

  // Repli : page d'erreur rendue `step-<clé de message>`.
  const messages = ctx.states.filter((s) => s.kind === 'message');
  const byKey = messages.filter((s) => s.key === hit.step).map(ref);
  if (byKey.length) return byKey;
  if (hit.match === 'prefix' && 'internalError'.startsWith(hit.step) && hit.step.length > 0) {
    const journeyError = messages.find((s) => s.group === JOURNEY_GROUP && s.key === 'internalError');
    if (journeyError) return [ref(journeyError)];
  }
  return [];
}

export function markerStateCandidates(m: Marker, ctx: ResolveContext): string[] {
  return markerCandidates(m, ctx.states);
}

export function methodCandidates(method: string, ctx: ResolveContext): string[] {
  const s = ctx.config.methodStates?.[method];
  return s ? [s] : [];
}

/**
 * Chemin nominal sur lequel se trouve le test : celui qui contient le plus
 * d'états que le test nomme sans doute. Égalité ou aucun : pas de canal.
 */
export function channelOf(sure: Set<string>, paths: NominalPath[] | undefined): NominalPath | null {
  if (!paths || paths.length < 2) return null;
  const scored = paths.map((p) => ({ p, n: p.screens.filter((s) => sure.has(s)).length })).sort((a, b) => b.n - a.n);
  const [best, second] = scored;
  if (!best || best.n === 0 || (second && second.n === best.n)) return null;
  return best.p;
}

/**
 * testResolver : garder ce qui est sur le chemin du test (écrans du chemin,
 * sinon ses sessions), puis retirer les états que le test nomme sans doute ailleurs.
 */
export function testResolver(cands: string[], sure: Set<string>, channel: NominalPath | null): string[] {
  let out = cands;
  if (channel) {
    const onScreens = out.filter((c) => channel.screens.includes(c));
    const groups = new Set(channel.screens.map(groupOf));
    const onGroups = out.filter((c) => groups.has(groupOf(c)));
    if (onScreens.length) out = onScreens;
    else if (onGroups.length) out = onGroups;
  }
  if (out.length > 1) {
    const notElsewhere = out.filter((c) => !sure.has(c));
    if (notElsewhere.length) out = notElsewhere;
  }
  return out;
}

const words = (s: string): string[] =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Mots du suffixe qui distinguent cette capture des autres captures du test. */
export function distinctiveWords(shot: ScreenshotHit, all: ScreenshotHit[]): string[] {
  const own = words(shot.suffix ?? '');
  const others = all.filter((s) => s !== shot && s.suffix).map((s) => new Set(words(s.suffix!)));
  return own.filter((w) => others.length === 0 || !others.every((o) => o.has(w)));
}

/**
 * shotsResolver (par capture) : mots distinctifs du suffixe, puis session de
 * la dernière page utilisée avant la capture.
 */
export function shotsResolver(
  cands: string[],
  distinctive: string[],
  trailGroup: string | null,
  labels: Record<string, string>,
): string[] {
  if (distinctive.length) {
    const matching = cands.filter((c) => {
      const vocab = new Set([...words(c), ...words(labels[groupOf(c)] ?? '')]);
      return distinctive.some((w) => vocab.has(w));
    });
    if (matching.length === 1) return matching;
  }
  if (trailGroup) {
    const same = cands.filter((c) => groupOf(c) === trailGroup);
    if (same.length === 1) return same;
  }
  return cands;
}

/** Messages qu'un suffixe de capture nomme, parmi ceux des groupes de la page. */
export function suffixMessages(suffix: string | null, pageStates: string[], states: FrontState[]): string[] {
  if (!suffix) return [];
  const groups = new Set(pageStates.map(groupOf));
  const messages = states.filter((s) => s.kind === 'message' && groups.has(s.group));
  const tokens = `-${words(suffix).join('-')}-`;
  const named = new Set<string>();
  const kebab = (k: string) => `-${words(k).join('-')}-`;
  const hits = messages.filter((m) => tokens.includes(kebab(m.key)));
  // Le plus long l'emporte : `code-helper-text-on-error` contient `helper-text-on-error`.
  for (const m of hits) {
    if (!hits.some((o) => o !== m && kebab(o.key).length > kebab(m.key).length && kebab(o.key).includes(kebab(m.key)))) named.add(ref(m));
  }
  for (const [alias, keys] of Object.entries(MESSAGE_SUFFIX_ALIASES)) {
    if (!tokens.includes(`-${alias}-`)) continue;
    for (const m of messages) if (keys.includes(m.key)) named.add(ref(m));
  }
  return [...named];
}
