<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import RunThread from '../components/RunThread.vue';
import { runEngine } from '../engine';
import { loadRun, pollRuns, runAgent, runsStore } from '../store';

/**
 * Onboarding (§13.3) : l'agent lance `pnpm onboard`, enquête en lecture seule,
 * remplit les propositions avec preuve et confiance, puis S'ARRÊTE.
 */
const props = defineProps<{ journey: string }>();
const report = ref<{ report: string | null; draft: string | null } | null>(null);
const survey = ref<{ process: string; file: string; configured: boolean }[]>([]);
const target = ref(props.journey);
const selected = ref<string | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

async function refreshReport() {
  report.value = await runEngine(['onboard-report', target.value]);
}
onMounted(async () => {
  void pollRuns();
  survey.value = (await runEngine<{ processes: typeof survey.value }>(['onboard-survey'])).processes;
});
watch(() => props.journey, (id) => ((target.value = id), (selected.value = null)), { immediate: true });
watch(target, () => void refreshReport(), { immediate: true });
const runs = computed(() => runsStore.recent.filter((r) => r.kind === 'onboarding' && (r.journey === target.value || r.title.endsWith(target.value))));
watch(
  () => runs.value.find((r) => r.id === selected.value)?.status,
  (s, prev) => {
    if (prev === 'running' && s !== 'running') void refreshReport();
  },
);
async function open(id: string) {
  await loadRun(id);
  selected.value = id;
}
async function launch() {
  busy.value = true;
  error.value = null;
  try {
    selected.value = (await runAgent(['onboard', target.value])).id;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="onb">
    <section class="card">
      <header class="head">
        <h3>Onboarding</h3>
        <label class="small">Processus
          <select v-model="target">
            <option v-for="p in survey" :key="p.process" :value="p.process">{{ p.process }}{{ p.configured ? '' : ' (non configuré)' }}</option>
          </select>
        </label>
        <button class="primary" :disabled="busy" @click="launch">Lancer l'onboarding</button>
      </header>
      <p class="lede">L'agent (modèle le plus puissant) lance <code>pnpm onboard {{ target }}</code>, enquête sur chaque point à trancher en lecture seule, propose avec preuve (fichier:ligne) et confiance, puis s'arrête. Rien n'est appliqué sans ta validation.</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <ul v-if="runs.length" class="runs small">
        <li v-for="r in runs" :key="r.id"><button class="link" @click="open(r.id)">{{ r.title }}</button> — {{ r.status }} · {{ r.totalCost.toFixed(2).replace('.', ',') }} $</li>
      </ul>
    </section>
    <section v-if="selected && runsStore.byId[selected]" class="card">
      <RunThread :run-id="selected" reply-cmd="onboard-reply" stop-cmd="onboarding-stop" />
    </section>
    <section class="card">
      <header class="head"><h3>Rapport</h3><button class="ghost" @click="refreshReport">Relire</button></header>
      <pre v-if="report?.report" class="doc">{{ report.report }}</pre>
      <p v-else class="muted">Pas encore de rapport : il est écrit par <code>pnpm onboard</code> au premier tour.</p>
      <details v-if="report?.draft"><summary>Brouillon de config</summary><pre class="doc">{{ report.draft }}</pre></details>
    </section>
  </div>
</template>

<style scoped>
.onb { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: center; gap: 14px; margin-bottom: 6px; }
.head h3 { flex: 1; }
.small { font-size: 12px; }
select { background: var(--ink); color: var(--text); border: 1px solid var(--rule); border-radius: 6px; padding: 4px 8px; margin-left: 6px; font-family: var(--font-mono); }
.runs { margin: 0; padding-left: 18px; }
.doc { white-space: pre-wrap; font-family: var(--font-mono); font-size: 12px; background: var(--ink); border: 1px solid var(--rule); border-radius: 6px; padding: 10px; color: var(--text-2); }
.primary { background: var(--accent); color: #0b1220; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-weight: 600; }
.primary:disabled { opacity: 0.5; }
</style>
