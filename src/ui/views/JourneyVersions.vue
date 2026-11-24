<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ImpactsResult } from '../../core/versions';
import { journeyVersions, loadImpacts, loadVersions, versionsStore } from '../store';

/** Sous-onglet « Versions » d'un parcours : diff entre deux versions et tests impactés. */
const props = defineProps<{ journey: string }>();
onMounted(() => {
  if (!versionsStore.data) void loadVersions(false);
});

const jv = computed(() => journeyVersions(props.journey));
const options = computed(() => [...(jv.value?.versions.map((v) => v.version) ?? []), 'local']);
const from = ref<string | null>(null);
const to = ref<string | null>(null);
const result = ref<ImpactsResult | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

watch(
  jv,
  (v) => {
    if (!v || from.value) return;
    const list = v.versions.map((x) => x.version);
    to.value = list.at(-1) ?? 'local';
    from.value = v.seen && list.includes(v.seen) && v.seen !== to.value ? v.seen : (list.at(-2) ?? to.value);
  },
  { immediate: true },
);

watch(
  [from, to],
  async ([f, t]) => {
    if (!f || !t) return;
    loading.value = true;
    error.value = null;
    try {
      result.value = await loadImpacts(props.journey, f, t);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

const CHANGE: Record<string, string> = { added: 'ajouté', removed: 'supprimé', modified: 'modifié' };
const REASON: Record<string, string> = { name: 'nom', wiring: 'câblage', configuration: 'configuration', condition: 'condition' };
const KIND: Record<string, string> = { direct: 'direct', 'via-subprocess': 'via le sous-processus', none: 'aucun test ne peut le voir' };
const testName = (id: string) => id.split(' › ').at(-1);
const counts = computed(() => result.value && { added: result.value.diff.added.length, removed: result.value.diff.removed.length, modified: result.value.diff.modified.length });
</script>

<template>
  <div class="jv">
    <p v-if="jv?.error" class="muted">{{ jv.error }}</p>
    <div v-else class="range card">
      <label>De <select v-model="from"><option v-for="o in options" :key="o" :value="o">{{ o }}</option></select></label>
      <label>à <select v-model="to"><option v-for="o in options" :key="o" :value="o">{{ o }}</option></select></label>
      <span class="muted small">Par défaut : de la version vue (sinon la précédente) à la dernière publiée.</span>
      <span v-if="loading" class="muted small">calcul…</span>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="result">
      <section class="card">
        <h3>Diff {{ result.from }} → {{ result.to }}</h3>
        <p class="lede">
          {{ counts!.added }} ajouté{{ counts!.added > 1 ? 's' : '' }}, {{ counts!.removed }} supprimé{{ counts!.removed > 1 ? 's' : '' }}, {{ counts!.modified }} modifié{{ counts!.modified > 1 ? 's' : '' }}.
          <template v-if="result.diff.emails.added.length"> E-mails apparus : {{ result.diff.emails.added.join(', ') }}.</template>
          <template v-if="result.diff.emails.removed.length"> E-mails disparus : {{ result.diff.emails.removed.join(', ') }}.</template>
          <template v-if="result.diff.sessions.added.length || result.diff.sessions.removed.length"> Sessions : +{{ result.diff.sessions.added.join(', ') || '0' }} / −{{ result.diff.sessions.removed.join(', ') || '0' }}.</template>
        </p>
        <p v-if="!result.elements.length" class="muted">Aucun changement.</p>
        <table v-else class="data">
          <thead><tr><th>Changement</th><th>Élément</th><th>Portée</th><th>Impact</th><th class="r">Tests</th></tr></thead>
          <tbody>
            <tr v-for="e in result.elements" :key="e.change + e.id">
              <td>{{ CHANGE[e.change] }}<span v-if="e.reasons" class="muted small"> ({{ e.reasons.map((r) => REASON[r]).join(', ') }})</span></td>
              <td><code>{{ e.id }}</code><div class="muted small">{{ e.type }}{{ e.name ? ` · ${e.name}` : '' }}</div></td>
              <td class="small"><code v-if="e.scope.length">{{ e.scope.join(' / ') }}</code><span v-else class="muted">processus</span></td>
              <td class="small" :class="{ muted: e.kind === 'none' }">{{ KIND[e.kind] }}<template v-if="e.via"> ({{ e.via }})</template></td>
              <td class="r num">{{ e.tests.length }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h3>Tests impactés</h3>
        <p class="lede">Direct : le test atteint ce que l'élément prouve. Via le sous-processus : il traverse la session qui contient l'élément.</p>
        <p v-if="!result.tests.length" class="muted">Aucun test touché.</p>
        <table v-else class="data">
          <thead><tr><th>Test</th><th>Suite</th><th>Direct</th><th>Via le sous-processus</th></tr></thead>
          <tbody>
            <tr v-for="t in result.tests" :key="t.suite + t.test.id">
              <td>{{ testName(t.test.id) }}<div class="muted small"><code>{{ t.test.file }}:{{ t.test.line }}</code></div></td>
              <td class="small">{{ t.suite }}</td>
              <td class="small"><code v-for="id in t.direct" :key="id" class="pill">{{ id }}</code><span v-if="!t.direct.length" class="muted">—</span></td>
              <td class="small"><code v-for="id in t.via" :key="id" class="pill">{{ id }}</code><span v-if="!t.via.length" class="muted">—</span></td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.jv { display: flex; flex-direction: column; gap: 16px; }
.range { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.range select { background: var(--ink); color: var(--text); border: 1px solid var(--rule); border-radius: 6px; padding: 4px 8px; margin-left: 6px; font-family: var(--font-mono); }
.small { font-size: 12px; }
.pill { display: inline-block; margin: 0 4px 4px 0; border: 1px solid var(--rule); border-radius: 3px; padding: 0 4px; }
</style>
