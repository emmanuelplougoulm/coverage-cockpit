<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { runEngine } from '../engine';

/** Gains rapides sans IA (§6) : aperçu en hunks, puis commit local sur clic confirmé. */
interface Plan {
  insertions: { file: string; line: number; text: string; states: string[]; tests: string[] }[];
  unplaced: { test: string; state: string; reason: string }[];
  hunks: { file: string; lines: { kind: string; text: string; line: number }[] }[];
  warnings: string[];
  command: string;
}
const props = defineProps<{ journey: string }>();
const emit = defineEmits<{ close: [] }>();
const plan = ref<Plan | null>(null);
const error = ref<string | null>(null);
const confirm = ref(false);
const result = ref<{ branch: string; commit: string; command: string } | null>(null);
const busy = ref(false);
onMounted(async () => {
  try {
    plan.value = (await runEngine<{ plan: Plan }>(['captures', props.journey])).plan;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});
async function apply() {
  busy.value = true;
  error.value = null;
  try {
    result.value = await runEngine(['apply-captures', props.journey]);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    confirm.value = false;
  }
}
const testName = (id: string) => id.split(' › ').at(-1);
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Gains rapides sans IA" @click.self="emit('close')">
    <section class="card dialog">
      <header><h3>Gains rapides sans IA</h3><button class="ghost" aria-label="Fermer" @click="emit('close')">✕</button></header>
      <p class="lede">Une capture <code>validateUI()</code> avant la première action sur chaque page objet qu'un test traverse déjà sans la capturer.</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="!plan && !error" class="muted">Calcul…</p>
      <template v-if="plan">
        <p v-if="!plan.insertions.length" class="muted">Rien à placer automatiquement.</p>
        <div v-for="h in plan.hunks" :key="h.file + h.lines[0]!.line" class="hunk">
          <div class="file"><code>{{ h.file }}</code></div>
          <pre><span v-for="l in h.lines" :key="l.line" :class="l.kind">{{ l.kind === 'added' ? '+' : ' ' }} {{ String(l.line).padStart(3) }}  {{ l.text }}
</span></pre>
        </div>
        <ul v-if="plan.warnings.length" class="warn small"><li v-for="w in plan.warnings" :key="w">{{ w }}</li></ul>
        <details v-if="plan.unplaced.length" open>
          <summary>{{ plan.unplaced.length }} cible{{ plan.unplaced.length > 1 ? 's' : '' }} non placée{{ plan.unplaced.length > 1 ? 's' : '' }}</summary>
          <ul class="small"><li v-for="u in plan.unplaced" :key="u.test + u.state"><code>{{ u.state }}</code> dans « {{ testName(u.test) }} » — {{ u.reason }}</li></ul>
        </details>
        <div v-if="result" class="done">
          Commit local <code>{{ result.commit }}</code> sur la branche <code>{{ result.branch }}</code>. Rien n'a été poussé.
          <div class="small">Écrire les premières références : <code>{{ result.command }}</code></div>
        </div>
        <footer v-else-if="plan.insertions.length">
          <span class="muted small">Commit local sur une nouvelle branche, jamais de push. Le dépôt de tests doit être propre.</span>
          <button v-if="!confirm" class="ghost" @click="confirm = true">Appliquer…</button>
          <template v-else>
            <button class="primary" :disabled="busy" @click="apply">Confirmer le commit local</button>
            <button class="link" @click="confirm = false">Annuler</button>
          </template>
        </footer>
      </template>
    </section>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 30; background: rgb(8 10 14 / 0.75); display: grid; place-items: center; padding: 24px; }
.dialog { width: min(980px, 100%); max-height: 90vh; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
header, footer { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
.small { font-size: 12px; }
.hunk { border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; }
.file { background: var(--panel-2); padding: 4px 8px; font-size: 12px; }
pre { margin: 0; padding: 6px 0; font-family: var(--font-mono); font-size: 12px; background: var(--ink); }
pre span { display: block; padding: 0 8px; white-space: pre; }
pre .added { background: rgb(12 163 12 / 0.15); color: var(--text); }
pre .context { color: var(--muted); }
.warn { color: var(--traversed); margin: 0; padding-left: 18px; }
.done { border-left: 3px solid var(--covered); padding: 6px 10px; background: var(--panel-2); }
.primary { background: var(--accent); color: #0b1220; border: 0; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-weight: 600; }
</style>
