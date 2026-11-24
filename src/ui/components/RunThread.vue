<script setup lang="ts">
import { computed, ref } from 'vue';
import { RUN_LABEL, type RunState } from '../../core/agents';
import { dateFr } from './chart';
import { runAgent, runsStore } from '../store';

/**
 * Fil d'un run d'agent : tours (demande / réponses de l'agent), questions de
 * l'agent à part, UNE prochaine étape dans la barre, coût.
 */
const props = defineProps<{ runId: string; replyCmd: string; stopCmd: string; closeCmd?: string | undefined; reopenCmd?: string | undefined; codePhase?: boolean }>();
const run = computed<RunState | undefined>(() => runsStore.byId[props.runId]);
const text = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
const money = (n: number | undefined) => (n === undefined ? '—' : `${n.toFixed(2).replace('.', ',')} $`);
const visiblePrompt = (p: string) => p.replace(/^<!--[^>]*-->\n?/, '').trim();

async function act(args: string[]) {
  busy.value = true;
  error.value = null;
  try {
    await runAgent(args);
    text.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
const lastTools = computed(() => {
  const t = run.value?.turns.at(-1)?.tools ?? [];
  const counts = new Map<string, number>();
  t.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  return [...counts.entries()].map(([k, n]) => `${k} ×${n}`).join(', ');
});
</script>

<template>
  <div v-if="run" class="thread">
    <header class="meta small">
      <span class="kind">{{ RUN_LABEL[run.kind] }}</span>
      <span>modèle <code>{{ run.model }}</code></span>
      <span v-if="run.branch">branche <code>{{ run.branch }}</code></span>
      <span v-if="run.phase">phase {{ run.phase === 'design' ? 'conception' : run.phase === 'code' ? 'code' : run.phase }}</span>
      <span class="num">coût {{ money(run.totalCost) }}</span>
      <span class="muted">{{ dateFr(run.createdAt, true) }}</span>
    </header>
    <ul v-if="run.notes.length" class="notes small"><li v-for="n in run.notes" :key="n">{{ n }}</li></ul>

    <ol class="turns">
      <li v-for="t in run.turns" :key="t.n">
        <div class="you"><span class="who">Toi</span><pre>{{ visiblePrompt(t.prompt) }}</pre></div>
        <div v-for="(m, i) in t.messages" :key="i" class="agent"><span class="who">Agent</span><pre>{{ m }}</pre></div>
        <div v-if="t.error" class="error small">{{ t.error }}</div>
        <div v-if="t.costDelta !== undefined" class="muted small num">tour {{ t.n }} : {{ money(t.costDelta) }}</div>
      </li>
    </ol>

    <section v-if="run.questions.length && run.status === 'waiting'" class="questions">
      <strong>Questions de l'agent</strong>
      <ul><li v-for="q in run.questions" :key="q">{{ q }}</li></ul>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <!-- Une seule prochaine étape -->
    <div class="bar">
      <template v-if="run.status === 'running'">
        <span class="working">L'agent travaille…<span v-if="lastTools" class="muted small"> ({{ lastTools }})</span></span>
        <button class="ghost" :disabled="busy" @click="act([props.stopCmd, run.id])">Arrêter</button>
      </template>
      <template v-else-if="run.status === 'closed'">
        <span class="muted">Clôturé.</span>
        <button v-if="props.reopenCmd" class="ghost" :disabled="busy" @click="act([props.reopenCmd, run.id])">Rouvrir</button>
      </template>
      <template v-else>
        <textarea v-model="text" rows="2" :placeholder="run.status === 'failed' ? 'Réessayer avec une précision…' : 'Répondre à l’agent…'" aria-label="Réponse à l'agent" />
        <button v-if="props.codePhase && run.phase === 'design' && run.status === 'waiting'" class="primary" :disabled="busy" @click="act([props.replyCmd, run.id, text || 'Cas validés.', '--phase', 'code'])">Passer au code</button>
        <button v-else class="primary" :disabled="busy || !text.trim()" @click="act([props.replyCmd, run.id, text])">{{ run.status === 'failed' ? 'Réessayer' : 'Répondre' }}</button>
        <button v-if="props.closeCmd && run.status !== 'failed'" class="ghost" :disabled="busy" @click="act([props.closeCmd, run.id])">Clôturer</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.thread { display: flex; flex-direction: column; gap: 10px; }
.small { font-size: 12px; }
.meta { display: flex; gap: 14px; flex-wrap: wrap; color: var(--text-2); }
.kind { text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.notes { margin: 0; padding-left: 18px; color: var(--traversed); }
.turns { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.you, .agent { display: grid; grid-template-columns: 52px 1fr; gap: 10px; }
.who { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); padding-top: 3px; }
pre { margin: 0; white-space: pre-wrap; font-family: var(--font-sans); font-size: 13px; line-height: 1.45; }
.you pre { color: var(--text-2); }
.agent pre { background: var(--panel-2); border: 1px solid var(--rule); border-radius: 6px; padding: 8px 10px; }
.questions { border-left: 3px solid var(--accent); background: var(--panel-2); padding: 8px 12px; border-radius: 4px; }
.questions ul { margin: 4px 0 0; padding-left: 18px; }
.bar { display: flex; gap: 8px; align-items: flex-end; border-top: 1px solid var(--rule); padding-top: 10px; position: sticky; bottom: 0; background: var(--panel); }
.bar textarea { flex: 1; background: var(--ink); color: var(--text); border: 1px solid var(--rule); border-radius: 6px; padding: 6px 8px; font: inherit; resize: vertical; }
.working { flex: 1; color: var(--traversed); }
.primary { background: var(--accent); color: #0b1220; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-weight: 600; }
.primary:disabled { opacity: 0.5; cursor: default; }
</style>
