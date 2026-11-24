<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { Suite } from '../core/coverage';
import TerminalPane from './components/TerminalPane.vue';
import Tooltip from './components/Tooltip.vue';
import { hideTip } from './components/tooltip';
import { loadAll, loadVersions, pollRuns, runsStore, store } from './store';
import JourneySpace from './views/JourneySpace.vue';
import Overview from './views/Overview.vue';
import TicketsTab from './views/TicketsTab.vue';
import VersionsTab from './views/VersionsTab.vue';

type Tab = 'overview' | 'journey' | 'tickets' | 'versions' | 'claude';

const TABS: { id: Tab; label: string; milestone?: number }[] = [
  { id: 'overview', label: "Vue d'ensemble" },
  { id: 'journey', label: 'Parcours' },
  { id: 'tickets', label: 'Mes tickets' },
  { id: 'versions', label: 'Versions BPMN' },
  { id: 'claude', label: 'Claude' },
];

const tab = ref<Tab>('overview');
const journey = ref<string | null>(null);
const suite = ref<Suite>('ui');
const sub = ref('coverage');

const current = computed(() => TABS.find((t) => t.id === tab.value)!);
const activeJourney = computed(() => journey.value ?? store.journeys?.journeys.find((j) => j.pilot)?.id ?? store.journeys?.journeys[0]?.id ?? null);

function openJourney(id: string, subTab?: string) {
  journey.value = id;
  if (subTab) sub.value = subTab;
  tab.value = 'journey';
}

/**
 * Mémoire du défilement par onglet, et dans « Parcours » par parcours, suite
 * et sous-onglet (§15). Gardée pour la session de l'app.
 */
const scrollKey = computed(() => (tab.value === 'journey' ? `journey|${activeJourney.value}|${suite.value}|${sub.value}` : tab.value));
const SCROLL = 'cc-scroll';
const positions: Record<string, number> = JSON.parse(sessionStorage.getItem(SCROLL) ?? '{}');
watch(
  scrollKey,
  async (next, prev) => {
    if (prev) positions[prev] = window.scrollY;
    sessionStorage.setItem(SCROLL, JSON.stringify(positions));
    hideTip();
    await nextTick();
    window.scrollTo({ top: positions[next] ?? 0 });
  },
  { flush: 'pre' },
);

onMounted(async () => {
  await loadAll();
  // Versions sans fetch au lancement (rapide) : pastille « nouvelles versions ».
  void loadVersions(false);
  void pollRuns();
});
/** ⌘J : le terminal se réduit en panneau sous la vue courante (et revient). */
const docked = ref(false);
const terminalVisible = computed(() => tab.value === 'claude' || docked.value);
const e2eRepo = computed(() => store.journeys?.repos.find((r) => r.key === 'e2e')?.path ?? null);
function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    if (tab.value === 'claude') {
      docked.value = true;
      tab.value = 'overview';
    } else docked.value = !docked.value;
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
const running = computed(() => runsStore.recent.filter((r) => r.status === 'running').length);
const money = (n: number | undefined) => `${(n ?? 0).toFixed(2).replace('.', ',')} $`;
</script>

<template>
  <header class="bar">
    <h1>Coverage Cockpit</h1>
    <nav aria-label="Onglets">
      <button v-for="t in TABS" :key="t.id" :class="{ active: t.id === tab }" :aria-current="t.id === tab ? 'page' : undefined" @click="tab = t.id">
        {{ t.label }}
      </button>
    </nav>
    <div class="spend small" :title="`Dépense IA totale : ${money(runsStore.spend?.total)}`">
      <span v-if="running" class="live">● {{ running }} run{{ running > 1 ? 's' : '' }} en cours</span>
      <span>IA aujourd'hui <span class="num">{{ money(runsStore.spend?.today) }}</span></span>
    </div>
  </header>

  <main>
    <Overview v-if="tab === 'overview'" @open="openJourney" />
    <JourneySpace
      v-else-if="tab === 'journey' && activeJourney"
      :journey="activeJourney"
      :suite="suite"
      :sub="sub"
      @journey="(id) => (journey = id)"
      @suite="(s) => (suite = s)"
      @sub="(s) => (sub = s)"
    />
    <p v-else-if="tab === 'journey'" class="muted">Aucun parcours configuré.</p>
    <section v-else-if="tab === 'claude'" class="claude-head">
      <h2>Claude</h2>
      <span class="muted">Terminal dans le dépôt de tests · ⌘J le réduit en panneau sous la vue</span>
    </section>
    <VersionsTab v-else-if="tab === 'versions'" @open="(id) => openJourney(id, 'versions')" />
    <TicketsTab v-else-if="tab === 'tickets'" @open="(id, s) => openJourney(id, s ?? 'tracking')" />
    <section v-else class="placeholder">
      <h2>{{ current.label }}</h2>
      <p class="muted">Arrive au jalon {{ current.milestone }}.</p>
    </section>
  </main>
  <div v-show="terminalVisible" :class="tab === 'claude' ? 'terminal full' : 'terminal dock'">
    <div v-if="tab !== 'claude'" class="dock-bar small"><span>Claude</span><button class="link" @click="docked = false">Réduire (⌘J)</button></div>
    <TerminalPane :cwd="e2eRepo" :visible="terminalVisible" />
  </div>
  <div v-if="docked && tab !== 'claude'" class="dock-space" />
  <Tooltip />
</template>

<style scoped>
.bar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 32px; padding: 0 24px; height: 52px; border-bottom: 1px solid var(--rule); background: var(--panel); }
.bar h1 { font-size: 17px; }
nav { display: flex; gap: 4px; }
nav button { background: none; border: 0; padding: 8px 12px; border-radius: 6px; color: var(--muted); cursor: pointer; }
nav button:hover { color: var(--text); }
nav button.active { color: var(--text); background: var(--rule); }
.spend { margin-left: auto; display: flex; gap: 14px; color: var(--text-2); }
.small { font-size: 12px; }
.live { color: var(--traversed); }
main { padding: 24px; max-width: 1440px; margin: 0 auto; }
.placeholder h2 { margin-bottom: 8px; }
.claude-head { display: flex; align-items: baseline; gap: 16px; }
.terminal { position: fixed; left: 0; right: 0; z-index: 9; border-top: 1px solid var(--rule); }
.terminal.full { top: 140px; bottom: 0; margin: 0 24px 24px; border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; }
.terminal.dock { bottom: 0; height: 300px; display: flex; flex-direction: column; }
.dock-bar { display: flex; justify-content: space-between; padding: 4px 12px; background: var(--panel); border-bottom: 1px solid var(--rule); }
.dock-space { height: 300px; }
</style>
