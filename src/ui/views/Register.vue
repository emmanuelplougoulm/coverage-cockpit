<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { CoverageView } from '../../core/coverage';
import { FAMILIES, FAMILY_LABEL, familiesOf, scenarioRequest, smokeOf, smokeKey, smokeRequest, type AsideMap, type Family, type Scenario } from '../../core/families';
import RequestPanel from '../components/RequestPanel.vue';
import ScenarioChip from '../components/ScenarioChip.vue';
import Sketch from '../components/Sketch.vue';
import StatusChip from '../components/StatusChip.vue';
import { imagesAllowed, setAside, validateSmoke } from '../store';

/**
 * Registre (§8, §15) : une ligne par scénario, rangée en cinq familles, avec
 * le bandeau smoke en tête. « Écarter » un écran le sort du compte, avec raison.
 */
const props = defineProps<{
  journey: { id: string; label: string };
  ui: CoverageView;
  workflow?: CoverageView | undefined;
  aside: AsideMap;
  validations: Record<string, string>;
  thumbs: Map<string, string>;
  texts: Record<string, Record<string, Record<string, string>>>;
}>();
const emit = defineEmits<{ view: [image: string]; write: [text: string] }>();

const register = computed(() => familiesOf(props.ui, props.aside, props.workflow));
const smoke = computed(() => smokeOf(props.ui, props.validations));
const smokePaths = computed(() => [...new Set(smoke.value.map((s) => s.pathId))]);
const filter = ref<Family | null>(null);
const shown = computed(() => register.value.scenarios.filter((s) => !filter.value || s.family === filter.value));

const open = reactive(new Set<string>());
const toggle = (id: string) => (open.has(id) ? open.delete(id) : open.add(id));
const request = ref<{ id: string; text: string } | null>(null);
const asking = reactive<Record<string, string>>({});
const busy = ref(false);
const error = ref<string | null>(null);
const testName = (id: string) => id.split(' › ').at(-1);
const SOURCE: Record<string, string> = {
  config: 'déclaré dans la config',
  p1: 'lu dans le test workflow @P1 (confiance moyenne)',
  bpmn: 'proposé depuis le BPMN : à valider, jamais à contrôler',
};

async function run(f: () => Promise<void>) {
  busy.value = true;
  error.value = null;
  try {
    await f();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
function confirmAside(ref: string) {
  const reason = asking[ref]?.trim();
  if (!reason) return;
  void run(async () => {
    await setAside(props.journey.id, ref, reason);
    delete asking[ref];
  });
}
const pct = (s: Scenario) => (s.total ? Math.round((100 * s.done) / s.total) : 0);
</script>

<template>
  <div class="register">
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <!-- Bandeau smoke -->
    <section class="card smoke">
      <header>
        <h3>Smoke</h3>
        <span class="muted small">Chemin nominal {{ SOURCE[register.nominal.source ?? ''] ?? '' }}<template v-if="register.nominal.evidence"> · <code>{{ register.nominal.evidence }}</code></template></span>
      </header>
      <template v-if="register.nominalUnknown">
        <p><strong>Chemin nominal inconnu.</strong> <span class="muted">Ni config, ni test workflow @P1, ni proposition BPMN.</span></p>
        <button class="ghost" @click="request = { id: 'smoke', text: smokeRequest(props.journey, props.ui.locales) }">Demander un smoke</button>
        <RequestPanel v-if="request?.id === 'smoke'" :text="request.text" @close="request = null" @use="emit('write', request!.text)" />
      </template>
      <table v-else class="data">
        <thead><tr><th>Chemin</th><th v-for="l in props.ui.locales" :key="l">{{ l }}</th></tr></thead>
        <tbody>
          <tr v-for="pid in smokePaths" :key="pid">
            <td>{{ smoke.find((s) => s.pathId === pid)?.pathLabel }}</td>
            <td v-for="c in smoke.filter((s) => s.pathId === pid)" :key="c.locale">
              <ScenarioChip :state="c.status" />
              <span class="num small gap">{{ c.captured }}/{{ c.total }} capturés</span>
              <div v-if="c.test" class="small">
                {{ testName(c.test.id) }}
                <span v-if="c.validated" class="ok">· validé à la main</span>
                <button v-else class="link" :disabled="busy" @click="run(() => validateSmoke(props.journey.id, smokeKey(c.pathId, c.locale), c.test!.id))">Valider</button>
              </div>
              <div v-else class="muted small">aucun test nominal sur ce canal</div>
              <div v-if="c.staleValidation" class="warn small">validation périmée ({{ testName(c.staleValidation) }} n'est plus le smoke)</div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Compteurs par famille -->
    <div class="families" role="group" aria-label="Familles">
      <button v-for="f in FAMILIES" :key="f" class="fam" :class="{ on: filter === f }" :aria-pressed="filter === f" @click="filter = filter === f ? null : f">
        <span class="fam-label">{{ FAMILY_LABEL[f] }}</span>
        <span class="fam-num num">{{ register.counts[f].done }}<span class="muted">/{{ register.counts[f].total }}</span></span>
        <span class="fam-sub small">
          {{ register.counts[f].scenarios }} scénario{{ register.counts[f].scenarios > 1 ? 's' : '' }} ·
          {{ register.counts[f].states.done }} fait{{ register.counts[f].states.done > 1 ? 's' : '' }} ·
          {{ register.counts[f].states.partial }} partiel{{ register.counts[f].states.partial > 1 ? 's' : '' }}
        </span>
        <span class="bar"><span :style="{ width: `${register.counts[f].total ? (100 * register.counts[f].done) / register.counts[f].total : 0}%` }" /></span>
      </button>
    </div>

    <!-- Lignes -->
    <section v-for="f in FAMILIES.filter((x) => shown.some((s) => s.family === x))" :key="f" class="card fam-block">
      <h3>{{ FAMILY_LABEL[f] }}</h3>
      <div v-for="s in shown.filter((x) => x.family === f)" :key="s.id" class="scenario" :class="{ dim: s.state === 'aside' }">
        <div class="line">
          <button class="link plain" :aria-expanded="open.has(s.id)" @click="toggle(s.id)">
            <span class="caret">{{ open.has(s.id) ? '▾' : '▸' }}</span>{{ s.label }}
          </button>
          <ScenarioChip :state="s.state" />
          <span class="num small done">{{ s.done }}/{{ s.total }}<span v-if="s.anyOf" class="muted"> · une capture suffit</span></span>
          <span class="muted small">{{ s.tests.length }} test{{ s.tests.length > 1 ? 's' : '' }}</span>
          <button v-if="s.state !== 'done' && s.state !== 'aside'" class="ghost small-btn" @click="request = request?.id === s.id ? null : { id: s.id, text: scenarioRequest(s, props.journey) }">
            {{ s.tests.length ? 'Compléter' : 'Écrire' }}
          </button>
        </div>
        <div class="chain" :aria-label="`Écrans de ${s.label}`">
          <template v-for="(st, i) in s.steps" :key="st.ref">
            <span v-if="i && !s.anyOf" class="arrow" aria-hidden="true">→</span>
            <span v-if="i && s.anyOf" class="arrow" aria-hidden="true">|</span>
            <span class="step" :class="{ aside: st.aside }" :title="st.aside ? `écarté : ${st.aside.reason}` : st.ref">
              {{ st.label }}
              <span class="dots">
                <StatusChip v-for="(c, l) in st.byLocale" :key="l" :status="c.status" compact />
              </span>
            </span>
          </template>
        </div>
        <RequestPanel v-if="request?.id === s.id" :text="request.text" @close="request = null" @use="emit('write', request!.text)" />

        <div v-if="open.has(s.id)" class="detail">
          <div v-for="st in s.steps" :key="st.ref" class="step-detail">
            <div class="sd-head">
              <code>{{ st.ref }}</code> <span class="muted small">{{ st.session }}</span>
              <template v-if="!st.ref.startsWith('email:')">
                <span v-if="st.aside" class="small">
                  <span class="muted">écarté : {{ st.aside.reason }}</span>
                  <button class="link" :disabled="busy" @click="run(() => setAside(props.journey.id, st.ref, null))">Réintégrer</button>
                </span>
                <span v-else-if="asking[st.ref] !== undefined" class="ask">
                  <input v-model="asking[st.ref]" placeholder="Raison (obligatoire)" aria-label="Raison de l'écart" @keydown.enter="confirmAside(st.ref)" />
                  <button class="ghost small-btn" :disabled="busy || !asking[st.ref]?.trim()" @click="confirmAside(st.ref)">Écarter</button>
                  <button class="link" @click="delete asking[st.ref]">Annuler</button>
                </span>
                <button v-else class="link small" @click="asking[st.ref] = ''">Écarter…</button>
              </template>
            </div>
            <div class="sd-cols">
              <div v-for="(c, l) in st.byLocale" :key="l" class="sd-col">
                <div class="small"><strong>{{ l }}</strong> <StatusChip :status="c.status" /></div>
                <button v-if="c.capture?.image && imagesAllowed() && props.thumbs.get(c.capture.image)" class="thumb-btn" @click="emit('view', c.capture.image!)">
                  <img :src="props.thumbs.get(c.capture.image)" alt="Capture de référence" />
                </button>
                <div v-else-if="c.capture?.image" class="masked">image masquée</div>
                <Sketch v-else-if="!st.ref.startsWith('email:')" :texts="props.texts[l]?.[st.ref]" :label="st.label" />
                <ul class="tests small"><li v-for="t in c.tests" :key="t.id">{{ testName(t.id) }}</li></ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.register { display: flex; flex-direction: column; gap: 16px; }
.small { font-size: 12px; }
.smoke header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.ok { color: var(--text-2); }
.gap { margin-left: 8px; }
.warn { color: var(--traversed); }
.families { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.fam { text-align: left; background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 3px; }
.fam.on { border-color: var(--accent); }
.fam-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.fam-num { font-size: 22px; font-weight: 600; }
.fam-sub { color: var(--text-2); }
.bar { height: 4px; background: var(--rule); border-radius: 2px; overflow: hidden; margin-top: 4px; }
.bar span { display: block; height: 100%; background: var(--covered); }
.fam-block h3 { margin-bottom: 6px; }
.scenario { border-top: 1px solid var(--rule); padding: 10px 0; }
.scenario.dim { opacity: 0.55; }
.line { display: flex; gap: 12px; align-items: center; }
.plain { color: var(--text); text-decoration: none; font-weight: 500; }
.caret { display: inline-block; width: 14px; color: var(--muted); }
.done { margin-left: auto; }
.small-btn { font-size: 12px; padding: 3px 10px; }
.chain { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0 0 14px; }
.arrow { color: var(--muted); }
.step { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--rule); border-radius: 4px; padding: 2px 6px; font-size: 12px; font-family: var(--font-mono); }
.step.aside { text-decoration: line-through; color: var(--muted); }
.dots { display: inline-flex; gap: 2px; }
.detail { margin: 10px 0 0 14px; display: flex; flex-direction: column; gap: 14px; }
.sd-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.ask { display: inline-flex; gap: 6px; align-items: center; }
.ask input { background: var(--ink); color: var(--text); border: 1px solid var(--rule); border-radius: 4px; padding: 3px 6px; font: inherit; font-size: 12px; width: 260px; }
.sd-cols { display: flex; gap: 16px; margin-top: 6px; }
.sd-col { width: 150px; }
.sd-col img { width: 150px; border-radius: 6px; border: 1px solid var(--rule); display: block; margin-top: 4px; }
.thumb-btn { background: none; border: 0; padding: 0; cursor: zoom-in; }
.masked { aspect-ratio: 390 / 720; display: grid; place-items: center; border: 1px dashed var(--rule); border-radius: 8px; color: var(--muted); font-size: 11px; margin-top: 4px; }
.tests { list-style: none; padding: 0; margin: 6px 0 0; color: var(--text-2); }
@media (max-width: 1100px) { .families { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
