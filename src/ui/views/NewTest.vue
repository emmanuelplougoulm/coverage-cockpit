<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { BranchChoice } from '../../core/agents';
import RunThread from '../components/RunThread.vue';
import { dateFr } from '../components/chart';
import { runEngine } from '../engine';
import { loadRun, pollRuns, runAgent, runsStore } from '../store';

/**
 * « Nouveau test » (§13.1) : conception des cas puis code, sur une branche
 * choisie au lancement ; et « Demande » : une question à l'IA, lecture seule.
 */
const props = defineProps<{ journey: string }>();
const mode = ref<'test' | 'ask'>('test');
const selected = ref<string | null>(null);
const request = ref('');
const question = ref('');
const choice = ref<BranchChoice | null>(null);
const stay = ref(false);
const branchName = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

onMounted(() => void pollRuns());
watch(
  () => props.journey,
  async (id) => {
    selected.value = null;
    request.value = runsStore.draftRequest[id] ?? '';
    delete runsStore.draftRequest[id];
    choice.value = await runEngine<BranchChoice>(['branch-choice', id, 'generation']);
    branchName.value = choice.value.proposed.name;
    stay.value = false;
  },
  { immediate: true },
);
const runs = computed(() => runsStore.recent.filter((r) => r.journey === props.journey && (mode.value === 'test' ? r.kind === 'generation' : r.kind === 'request')));
async function open(id: string) {
  await loadRun(id);
  selected.value = id;
}
async function launch() {
  busy.value = true;
  error.value = null;
  try {
    const args =
      mode.value === 'test'
        ? ['create-test', props.journey, request.value, ...(stay.value ? ['--stay'] : ['--branch', branchName.value])]
        : ['ask', props.journey, question.value];
    const s = await runAgent(args);
    selected.value = s.id;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
const STATUS: Record<string, string> = { running: 'en cours', waiting: 'attend ta réponse', failed: 'échec', stopped: 'arrêté', closed: 'clôturé' };
</script>

<template>
  <div class="newtest">
    <aside class="card side">
      <div class="seg" role="group" aria-label="Type">
        <button :class="{ on: mode === 'test' }" @click="(mode = 'test'), (selected = null)">Nouveau test</button>
        <button :class="{ on: mode === 'ask' }" @click="(mode = 'ask'), (selected = null)">Demande</button>
      </div>
      <button class="ghost wide" @click="selected = null">+ {{ mode === 'test' ? 'Nouveau test' : 'Nouvelle demande' }}</button>
      <ul class="runs">
        <li v-for="r in runs" :key="r.id" :class="{ on: r.id === selected }">
          <button class="link plain" @click="open(r.id)">{{ r.title }}</button>
          <div class="muted small">{{ STATUS[r.status] }} · {{ dateFr(r.createdAt, true) }} · {{ r.totalCost.toFixed(2).replace('.', ',') }} $</div>
        </li>
        <li v-if="!runs.length" class="muted small">Aucun run pour ce parcours.</li>
      </ul>
    </aside>

    <section class="card main">
      <RunThread
        v-if="selected && runsStore.byId[selected]"
        :run-id="selected"
        :reply-cmd="mode === 'test' ? 'generation-reply' : 'ask-reply'"
        :stop-cmd="mode === 'test' ? 'generation-stop' : 'request-stop'"
        :close-cmd="mode === 'test' ? 'generation-close' : 'request-close'"
        :reopen-cmd="mode === 'test' ? 'generation-reopen' : undefined"
        :code-phase="mode === 'test'"
      />
      <form v-else class="form" @submit.prevent="launch">
        <template v-if="mode === 'test'">
          <h3>Nouveau test</h3>
          <p class="lede">D'abord la conception des cas (rien n'est écrit), puis le code : écrit, exécuté, commité localement. Jamais de push.</p>
          <label class="field">Demande
            <textarea v-model="request" rows="7" placeholder="Texte libre, ou demande préremplie depuis le registre ou un ticket." />
          </label>
          <fieldset v-if="choice" class="branch">
            <legend>Branche du dépôt de tests</legend>
            <p v-if="!choice.isGit" class="warn small">{{ choice.current.reason }} : aucune branche, aucun commit — l'agent ne pourra rien committer.</p>
            <template v-else>
              <label :class="{ dim: !choice.current.canStay }">
                <input v-model="stay" type="radio" :value="true" :disabled="!choice.current.canStay" />
                Rester sur <code>{{ choice.current.branch ?? 'HEAD détachée' }}</code>
                <span v-if="!choice.current.canStay" class="muted small">— {{ choice.current.reason }}</span>
                <span v-else-if="choice.current.sameJourney" class="muted small">— branche de ce parcours</span>
              </label>
              <label>
                <input v-model="stay" type="radio" :value="false" />
                Nouvelle branche <input v-model="branchName" class="inline" :disabled="stay" aria-label="Nom de la nouvelle branche" />
                <span class="muted small">depuis <code>{{ choice.proposed.base }}</code>{{ choice.proposed.refreshMain ? ', principale rafraîchie avant de couper' : '' }}</span>
              </label>
              <p v-if="choice.current.dirty" class="warn small">Le dépôt a des modifications non commitées : la branche ne sera pas changée ; elles seront signalées à l'agent.</p>
            </template>
          </fieldset>
        </template>
        <template v-else>
          <h3>Demande</h3>
          <p class="lede">Une question à l'IA sur ce parcours : lecture seule, rien n'est écrit.</p>
          <label class="field">Question <textarea v-model="question" rows="5" /></label>
        </template>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="actions">
          <span class="muted small">Modèle épinglé au lancement et gardé à chaque reprise.</span>
          <button class="primary" :disabled="busy || !(mode === 'test' ? request.trim() : question.trim())">{{ mode === 'test' ? 'Lancer la conception' : 'Envoyer' }}</button>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.newtest { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; align-items: start; }
.side { display: flex; flex-direction: column; gap: 10px; }
.seg { display: inline-flex; border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; }
.seg button { flex: 1; background: none; border: 0; padding: 5px 10px; color: var(--muted); cursor: pointer; }
.seg button.on { background: var(--rule); color: var(--text); }
.wide { width: 100%; }
.runs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.runs li { border-left: 2px solid transparent; padding-left: 8px; }
.runs li.on { border-left-color: var(--accent); }
.plain { color: var(--text); text-decoration: none; text-align: left; }
.small { font-size: 12px; }
.form { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--text-2); }
textarea, .inline { background: var(--ink); color: var(--text); border: 1px solid var(--rule); border-radius: 6px; padding: 6px 8px; font: inherit; }
.inline { font-family: var(--font-mono); width: 280px; margin-left: 6px; }
.branch { border: 1px solid var(--rule); border-radius: 6px; padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
.branch legend { font-size: 12px; color: var(--muted); padding: 0 4px; }
.dim { opacity: 0.6; }
.warn { color: var(--traversed); }
.actions { display: flex; justify-content: space-between; align-items: center; }
.primary { background: var(--accent); color: #0b1220; border: 0; border-radius: 6px; padding: 7px 14px; cursor: pointer; font-weight: 600; }
.primary:disabled { opacity: 0.5; cursor: default; }
</style>
