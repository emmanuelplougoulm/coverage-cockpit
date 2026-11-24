import { reactive } from 'vue';
import type { JourneysResult } from '../core/contract';
import type { CoverageView, Suite } from '../core/coverage';
import type { CacheInfo, CoverageResult, LastViews, Snapshot } from '../core/history';
import type { AsideMap } from '../core/families';
import type { SketchesResult, ThumbnailsResult } from '../core/media';
import type { ImpactsResult, JourneyVersions, VersionsResult } from '../core/versions';
import type { TicketsResult } from '../core/tickets';
import type { AssertionAudit } from '../core/knowledge';
import { RUN_LABEL, type RunState, type RunSummary, type SpendSummary } from '../core/agents';
import { runEngine } from './engine';

/**
 * État partagé de l'interface. Tout vient du moteur par `runEngine` ; rien
 * n'est recalculé ici que les indicateurs (fonctions pures de `core`).
 */

export interface JourneyState {
  views: Partial<Record<Suite, CoverageView>>;
  at: string | null;
  /** Vue affichée = dernière connue, en cours de vérification. */
  updating: boolean;
  cache?: CacheInfo;
  error?: string | undefined;
  history: Partial<Record<Suite, Snapshot[]>>;
  thumbnails?: ThumbnailsResult | undefined;
  sketches?: SketchesResult | undefined;
  /** Décisions locales : écrans écartés et smoke validé à la main. */
  decisions?: { aside: AsideMap; smoke: Record<string, string> } | undefined;
}

export const store = reactive({
  journeys: null as JourneysResult | null,
  byJourney: {} as Record<string, JourneyState>,
  /** Date de la visite précédente (« depuis ma dernière visite »). */
  previousVisit: null as string | null,
  loading: false,
  error: null as string | null,
});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const state = (id: string): JourneyState => (store.byJourney[id] ??= { views: {}, at: null, updating: false, history: {} });

let visited = false;

/** Lancement : dernières vues tout de suite, puis vérification parcours par parcours. */
export async function loadAll(): Promise<void> {
  store.loading = true;
  store.error = null;
  try {
    if (!visited) {
      visited = true;
      store.previousVisit = (await runEngine<{ previous: string | null }>(['visit', '--mark'])).previous;
    }
    const [journeys, last] = await Promise.all([
      runEngine<JourneysResult>(['journeys']),
      runEngine<{ journeys: LastViews[] }>(['last-views']),
    ]);
    store.journeys = journeys;
    const ready = journeys.journeys.filter((j) => j.status === 'ready').map((j) => j.id);
    for (const l of last.journeys) {
      const s = state(l.journey);
      s.views = { ...l.views };
      s.at = l.at;
      s.updating = ready.includes(l.journey);
    }
    for (const id of ready) {
      state(id).updating = true;
      await refresh(id, 'ui');
    }
  } catch (e) {
    store.error = message(e);
  } finally {
    store.loading = false;
  }
}

/** Recalcule (cache par empreinte) une suite d'un parcours, puis son historique. */
export async function refresh(id: string, suite: Suite, force = false): Promise<void> {
  const s = state(id);
  s.updating = true;
  try {
    const r = await runEngine<CoverageResult>(['coverage', id, '--suite', suite, ...(force ? ['--force'] : [])]);
    s.views[suite] = r.view;
    s.cache = r.cache;
    s.at = r.cache.analyzedAt;
    s.error = undefined;
    s.history[suite] = (await runEngine<{ snapshots: Snapshot[] }>(['history', id, '--suite', suite])).snapshots;
    if (r.cache.status === 'miss' || r.cache.status === 'forced') s.thumbnails = undefined;
  } catch (e) {
    s.error = message(e);
  } finally {
    s.updating = false;
  }
}

export async function ensureSuite(id: string, suite: Suite): Promise<void> {
  const s = state(id);
  if (!s.views[suite] || !s.history[suite]) await refresh(id, suite);
}

export async function ensureMedia(id: string): Promise<void> {
  const s = state(id);
  const [thumbs, sketches] = await Promise.all([
    s.thumbnails ? Promise.resolve(s.thumbnails) : runEngine<ThumbnailsResult>(['thumbnails', id]),
    s.sketches ? Promise.resolve(s.sketches) : runEngine<SketchesResult>(['sketches', id]),
  ]);
  s.thumbnails = thumbs;
  s.sketches = sketches;
}

export async function fullImage(id: string, image: string): Promise<string> {
  return (await runEngine<{ data: string }>(['image', id, image])).data;
}

export async function openImage(id: string, image: string): Promise<void> {
  await runEngine(['image', id, image, '--open']);
}

/**
 * Les images de test peuvent montrer des pièces justificatives : jamais
 * affichées en aperçu de développement (navigateur), sauf corpus explicite.
 */
export const imagesAllowed = (): boolean => '__TAURI_INTERNALS__' in window || import.meta.env.VITE_PREVIEW_IMAGES === '1';
export const inTauri = (): boolean => '__TAURI_INTERNALS__' in window;

export async function ensureDecisions(id: string): Promise<void> {
  const s = state(id);
  if (!s.decisions) s.decisions = await runEngine<{ aside: AsideMap; smoke: Record<string, string> }>(['aside', id]);
}

/** Écarte un écran (raison obligatoire) ou le réintègre (`reason` = null). */
export async function setAside(id: string, ref: string, reason: string | null): Promise<void> {
  const r = await runEngine<{ aside: AsideMap }>(['aside-set', id, ref, ...(reason === null ? ['--remove'] : [reason])]);
  const s = state(id);
  s.decisions = { aside: r.aside, smoke: s.decisions?.smoke ?? {} };
}

/** Valide à la main le smoke d'une langue (`test` = null pour retirer). */
export async function validateSmoke(id: string, key: string, test: string | null): Promise<void> {
  const r = await runEngine<{ smoke: Record<string, string> }>(['smoke-validate', id, key, ...(test === null ? ['--remove'] : [test])]);
  const s = state(id);
  s.decisions = { aside: s.decisions?.aside ?? {}, smoke: r.smoke };
}

// ——— versions BPMN (§12) ———

export const versionsStore = reactive({
  data: null as VersionsResult | null,
  loading: false,
  error: null as string | null,
  impacts: {} as Record<string, ImpactsResult>,
});

/** Versions de tous les parcours ; `fetch` = git fetch puis avance rapide sûre du dépôt workflow. */
export async function loadVersions(fetch = false): Promise<void> {
  versionsStore.loading = true;
  versionsStore.error = null;
  try {
    versionsStore.data = await runEngine<VersionsResult>(['versions', ...(fetch ? ['--fetch'] : [])]);
    if (versionsStore.data.fetch.updated) {
      // Le clone a avancé : les vues doivent être recalculées (le cache le verra).
      versionsStore.impacts = {};
      for (const id of Object.keys(store.byJourney)) void refresh(id, 'ui');
    }
  } catch (e) {
    versionsStore.error = message(e);
  } finally {
    versionsStore.loading = false;
  }
}

export async function markSeen(id: string, version: string): Promise<void> {
  await runEngine(['seen-set', id, version]);
  await loadVersions(false);
}

export async function loadImpacts(id: string, from: string, to: string): Promise<ImpactsResult> {
  const key = `${id}|${from}|${to}`;
  versionsStore.impacts[key] ??= await runEngine<ImpactsResult>(['impacts', id, '--from', from, '--to', to]);
  return versionsStore.impacts[key]!;
}

export async function bpmnXml(id: string, at = 'local'): Promise<{ xml: string; generated: boolean }> {
  return runEngine<{ xml: string; generated: boolean }>(['bpmn-xml', id, '--at', at]);
}

export const journeyVersions = (id: string): JourneyVersions | undefined => versionsStore.data?.journeys.find((j) => j.journey === id);

// ——— tickets (§9) et audit des assertions (§14) ———

export const ticketsStore = reactive({ data: null as TicketsResult | null, loading: false, error: null as string | null });

export async function loadTickets(): Promise<void> {
  ticketsStore.loading = true;
  ticketsStore.error = null;
  try {
    ticketsStore.data = await runEngine<TicketsResult>(['tickets']);
  } catch (e) {
    ticketsStore.error = message(e);
  } finally {
    ticketsStore.loading = false;
  }
}

export async function setCampaignTicket(journey: string, key: string | null): Promise<void> {
  const r = await runEngine<{ campaign: Record<string, string> }>(['campaign-ticket', journey, key ?? '--remove']);
  if (ticketsStore.data) ticketsStore.data.campaign = r.campaign;
  else campaignStore.campaign = r.campaign;
  campaignStore.campaign = r.campaign;
}

export const campaignStore = reactive({ campaign: null as Record<string, string> | null });
export async function ensureCampaign(): Promise<void> {
  if (!campaignStore.campaign) campaignStore.campaign = (await runEngine<{ campaign: Record<string, string> }>(['campaign-tickets'])).campaign;
}

export const auditStore = reactive({ byJourney: {} as Record<string, AssertionAudit> });
export async function loadAudit(id: string, force = false): Promise<AssertionAudit> {
  if (force || !auditStore.byJourney[id]) auditStore.byJourney[id] = await runEngine<AssertionAudit>(['assertions', id]);
  return auditStore.byJourney[id]!;
}

// ——— agents (§13) ———

export const runsStore = reactive({
  byId: {} as Record<string, RunState>,
  recent: [] as RunSummary[],
  spend: null as SpendSummary | null,
  /** Demande préremplie pour « Nouveau test » (depuis le registre ou un ticket). */
  draftRequest: {} as Record<string, string>,
  error: null as string | null,
});

let polling: ReturnType<typeof setInterval> | null = null;

/** Relit les runs récents et la dépense ; notifie une fin de run, où que soit l'utilisateur. */
export async function pollRuns(): Promise<void> {
  try {
    const before = new Map(runsStore.recent.map((r) => [r.id, r.status]));
    const [recent, spend] = await Promise.all([runEngine<{ runs: RunSummary[] }>(['recent-runs']), runEngine<SpendSummary>(['spend'])]);
    runsStore.recent = recent.runs;
    runsStore.spend = spend;
    for (const r of recent.runs) {
      const was = before.get(r.id);
      if (was === 'running' && r.status !== 'running') {
        void runEngine(['notify', 'Coverage Cockpit', `${RUN_LABEL[r.kind]} — ${r.status === 'failed' ? 'échec' : 'terminé'} : ${r.title.slice(0, 80)}`]);
        if (runsStore.byId[r.id]) runsStore.byId[r.id] = await runEngine<RunState>(['run', r.id]);
      } else if (r.status === 'running' && runsStore.byId[r.id]) {
        runsStore.byId[r.id] = await runEngine<RunState>(['run', r.id]);
      }
    }
    const anyRunning = recent.runs.some((r) => r.status === 'running');
    if (anyRunning && !polling) polling = setInterval(() => void pollRuns(), 2500);
    if (!anyRunning && polling) {
      clearInterval(polling);
      polling = null;
    }
  } catch (e) {
    runsStore.error = message(e);
  }
}

export async function loadRun(id: string): Promise<RunState> {
  runsStore.byId[id] = await runEngine<RunState>(['run', id]);
  return runsStore.byId[id]!;
}

/** Lance une commande d'agent qui rend un run, et suit son avancement. */
export async function runAgent(args: string[]): Promise<RunState> {
  const s = await runEngine<RunState>(args);
  runsStore.byId[s.id] = s;
  await pollRuns();
  return s;
}
