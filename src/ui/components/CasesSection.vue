<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { parseCaseDraft, type CaseRow } from '../../core/cases';
import RunThread from './RunThread.vue';
import { runEngine } from '../engine';
import { loadRun, runAgent, runsStore } from '../store';

/**
 * Cas de test (§9) : un cas par test. Brouillon par l'IA (lecture seule) ;
 * création, clé dans le test et états SEULEMENT sur clic confirmé.
 */
const props = defineProps<{ journey: string }>();
const rows = ref<CaseRow[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
const draftRun = ref<Record<string, string>>({});
const confirm = ref<string | null>(null);
const keyPreview = ref<Record<string, { before: string; after: string; committed: string | null; reason?: string }>>({});

async function load() {
  rows.value = (await runEngine<{ rows: CaseRow[] }>(['aio-cases', props.journey])).rows;
}
onMounted(() => void load().catch((e) => (error.value = String(e))));
const testName = (id: string) => id.split(' › ').at(-1);
const draftOf = (test: string) => {
  const id = draftRun.value[test];
  const r = id ? runsStore.byId[id] : undefined;
  if (!r || r.status === 'running') return null;
  const last = r.turns.at(-1);
  return parseCaseDraft(last?.result ?? last?.messages.at(-1));
};
async function run<T>(f: () => Promise<T>): Promise<T | undefined> {
  busy.value = true;
  error.value = null;
  try {
    return await f();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return undefined;
  } finally {
    busy.value = false;
    confirm.value = null;
  }
}
const linked = computed(() => rows.value.filter((r) => r.link && r.status && r.status !== 'Automatisé' && r.status !== 'n’existe plus').map((r) => r.link!.key));
</script>

<template>
  <section class="card">
    <header class="head">
      <h3>Cas de test</h3>
      <template v-if="linked.length">
        <button v-if="confirm !== 'bulk'" class="ghost" @click="confirm = 'bulk'">Publier et automatiser ({{ linked.length }})</button>
        <template v-else>
          <button class="primary" :disabled="busy" @click="run(async () => { await runEngine(['aio-case-set', 'Automatisé', ...linked]); await load(); })">Confirmer : {{ linked.join(', ') }}</button>
          <button class="link" @click="confirm = null">Annuler</button>
        </template>
      </template>
    </header>
    <p class="lede">Un cas par test. Les écritures vers l'outil n'ont lieu que sur clic confirmé ; l'outil ne sait pas supprimer.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <table class="data">
      <thead><tr><th>Test</th><th>Clé dans le test</th><th>Cas lié</th><th>État</th><th /></tr></thead>
      <tbody>
        <template v-for="r in rows" :key="r.test">
          <tr>
            <td>{{ testName(r.test) }}<div class="muted small"><code>{{ r.file }}:{{ r.line }}</code></div></td>
            <td class="small"><code v-if="r.tagKey">{{ r.tagKey === 'TODO' ? 'TC-TODO' : r.tagKey }}</code><span v-else class="muted">—</span></td>
            <td class="small"><code v-if="r.link">{{ r.link.key }}</code><span v-else class="muted">—</span></td>
            <td class="small">{{ r.status ?? (r.link ? 'inconnu' : '') }}</td>
            <td class="small actions">
              <button v-if="!r.link" class="ghost xs" :disabled="busy" @click="run(async () => { const s = await runAgent(['aio-case-draft', props.journey, r.test]); draftRun[r.test] = s.id; })">Rédiger le cas</button>
              <button v-if="r.link && !r.link.inTest" class="ghost xs" :disabled="busy" @click="run(async () => { keyPreview[r.test] = await runEngine(['aio-case-key', props.journey, '--test', r.test]); })">Clé dans le test…</button>
            </td>
          </tr>
          <tr v-if="draftRun[r.test]" class="detail">
            <td colspan="5">
              <RunThread v-if="runsStore.byId[draftRun[r.test]!]" :run-id="draftRun[r.test]!" reply-cmd="ask-reply" stop-cmd="run-stop" />
              <div v-if="draftOf(r.test)" class="draft">
                <strong>{{ draftOf(r.test)!.title }}</strong>
                <p class="small">{{ draftOf(r.test)!.preconditions }}</p>
                <table class="data steps"><thead><tr><th>#</th><th>Action</th><th>Données</th><th>Attendu</th><th>Rendu</th></tr></thead>
                  <tbody><tr v-for="(s, i) in draftOf(r.test)!.steps" :key="i"><td>{{ i + 1 }}</td><td>{{ s.action }}</td><td>{{ s.data }}</td><td>{{ s.expected }}</td><td><code>{{ s.rendering }}</code></td></tr></tbody>
                </table>
                <button v-if="confirm !== r.test" class="ghost" @click="confirm = r.test">Créer le cas…</button>
                <template v-else>
                  <button class="primary" :disabled="busy" @click="run(async () => { await runEngine(['aio-case-push', props.journey, draftRun[r.test]!]); delete draftRun[r.test]; await load(); })">Confirmer la création (brouillon, captures jointes)</button>
                  <button class="link" @click="confirm = null">Annuler</button>
                </template>
              </div>
            </td>
          </tr>
          <tr v-if="keyPreview[r.test]" class="detail">
            <td colspan="5" class="small">
              <pre class="diff"><span class="rm">- {{ keyPreview[r.test]!.before.trim() }}</span>
<span class="add">+ {{ keyPreview[r.test]!.after.trim() }}</span></pre>
              <p v-if="keyPreview[r.test]!.committed">Commit local <code>{{ keyPreview[r.test]!.committed }}</code>.</p>
              <p v-else-if="keyPreview[r.test]!.reason" class="warn">{{ keyPreview[r.test]!.reason }}</p>
              <template v-else>
                <button class="primary" :disabled="busy" @click="run(async () => { keyPreview[r.test] = await runEngine(['aio-case-key', props.journey, '--test', r.test, '--apply']); await load(); })">Écrire et commiter localement</button>
              </template>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.head { display: flex; align-items: center; gap: 10px; }
.head h3 { flex: 1; }
.small { font-size: 12px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.xs { font-size: 12px; padding: 2px 8px; }
.detail td { background: var(--panel-2); }
.draft { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.steps { font-size: 12px; }
.diff { margin: 0 0 6px; font-family: var(--font-mono); }
.diff .rm { color: var(--missing); }
.diff .add { color: var(--covered); }
.warn { color: var(--traversed); }
.primary { background: var(--accent); color: #0b1220; border: 0; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-weight: 600; }
</style>
