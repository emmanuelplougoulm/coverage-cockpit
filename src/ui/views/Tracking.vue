<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CoverageView } from '../../core/coverage';
import { smokeKey, smokeOf, tagIssues, type AsideMap } from '../../core/families';
import { dateFr } from '../components/chart';
import ScenarioChip from '../components/ScenarioChip.vue';
import CasesSection from '../components/CasesSection.vue';
import { campaignStore, ensureCampaign, setAside, setCampaignTicket, validateSmoke } from '../store';
import { onMounted } from 'vue';

/** Suivi (§15) : validation à la main du chemin nominal, écrans écartés, à nettoyer. */
const props = defineProps<{ journey: string; ui: CoverageView; aside: AsideMap; validations: Record<string, string> }>();

const smoke = computed(() => smokeOf(props.ui, props.validations));
const issues = computed(() => tagIssues(props.ui));
const stale = computed(() => smoke.value.filter((s) => s.staleValidation));
const asideList = computed(() => Object.entries(props.aside).sort(([, a], [, b]) => (a.at < b.at ? 1 : -1)));
const cleanup = computed(() => issues.value.length + stale.value.length + props.ui.orphanTemplates.length + props.ui.warnings.length);
const testName = (id: string) => id.split(' › ').at(-1);
onMounted(() => void ensureCampaign());
const campaignKey = computed(() => campaignStore.campaign?.[props.journey] ?? null);
const newKey = ref('');
const pending = computed(() => props.ui.catalog.pending);
const error = ref<string | null>(null);
const busy = ref(false);
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
</script>

<template>
  <div class="tracking">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <section class="card">
      <h3>Campagne</h3>
      <p class="lede">1 ticket par parcours = 1 branche du dépôt de tests (nom de branche = clé du ticket).</p>
      <p v-if="campaignKey">
        Ticket <code>{{ campaignKey }}</code> · branche <code>{{ campaignKey }}</code>
        <button class="link" style="margin-left: 10px" :disabled="busy" @click="run(() => setCampaignTicket(props.journey, null))">Retirer</button>
      </p>
      <form v-else class="inline" @submit.prevent="newKey.trim() && run(() => setCampaignTicket(props.journey, newKey.trim()))">
        <input v-model="newKey" placeholder="Clé du ticket (ex. PROJ-123)" aria-label="Clé du ticket de campagne" />
        <button class="ghost" :disabled="busy || !newKey.trim()">Définir</button>
        <span class="muted small">ou depuis « Mes tickets »</span>
      </form>
    </section>

    <section v-if="pending.length" class="card">
      <h3>À trancher (catalogue)</h3>
      <p class="lede">Une décision du catalogue s'applique, mais son lien ne désigne pas exactement un élément : à décider dans la config.</p>
      <ul class="clean">
        <li v-for="p in pending" :key="p.decision + p.target"><code>{{ p.target }}</code> — décision <code>{{ p.decision }}</code> : {{ p.why }}<div class="muted small">candidats : {{ p.candidates.join(', ') || 'aucun' }}</div></li>
      </ul>
    </section>

    <section class="card">
      <h3>Validation du chemin nominal</h3>
      <p class="lede">Le smoke d'une langue est le test nominal qui capture le plus d'écrans de son canal. Une validation tient tant que ce même test reste le smoke.</p>
      <p v-if="!smoke.length" class="muted">Aucun chemin nominal connu.</p>
      <table v-else class="data">
        <thead><tr><th>Chemin</th><th>Langue</th><th>État</th><th>Smoke</th><th>Validation</th></tr></thead>
        <tbody>
          <tr v-for="c in smoke" :key="c.pathId + c.locale">
            <td>{{ c.pathLabel }}</td>
            <td class="num">{{ c.locale }}</td>
            <td><ScenarioChip :state="c.status" /><span class="num small" style="margin-left: 8px">{{ c.captured }}/{{ c.total }}</span></td>
            <td class="small">{{ c.test ? testName(c.test.id) : '—' }}<div v-if="c.test" class="muted"><code>{{ c.test.file }}:{{ c.test.line }}</code></div></td>
            <td class="small">
              <template v-if="c.validated">
                validé à la main
                <button class="link" :disabled="busy" @click="run(() => validateSmoke(props.journey, smokeKey(c.pathId, c.locale), null))">Retirer</button>
              </template>
              <button v-else-if="c.test" class="ghost" :disabled="busy" @click="run(() => validateSmoke(props.journey, smokeKey(c.pathId, c.locale), c.test!.id))">Valider</button>
              <span v-else class="muted">rien à valider</span>
              <div v-if="c.staleValidation" class="warn">périmée : validée pour « {{ testName(c.staleValidation) }} »</div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <CasesSection :journey="props.journey" />

    <section class="card">
      <h3>Écrans écartés</h3>
      <p class="lede">Sortis du compte du registre, avec leur raison. On les écarte depuis le registre.</p>
      <p v-if="!asideList.length" class="muted">Aucun écran écarté.</p>
      <table v-else class="data">
        <thead><tr><th>Écran</th><th>Raison</th><th>Depuis</th><th /></tr></thead>
        <tbody>
          <tr v-for="[ref, a] in asideList" :key="ref">
            <td><code>{{ ref }}</code></td>
            <td>{{ a.reason }}</td>
            <td class="num small">{{ dateFr(a.at, true) }}</td>
            <td><button class="link" :disabled="busy" @click="run(() => setAside(props.journey, ref, null))">Réintégrer</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <h3>À nettoyer <span class="muted num">({{ cleanup }})</span></h3>
      <p v-if="!cleanup" class="muted">Rien à nettoyer.</p>
      <ul class="clean">
        <li v-for="i in issues" :key="i.test.id"><strong>Tag</strong> {{ testName(i.test.id) }} — {{ i.issue }} <code class="muted">{{ i.test.file }}:{{ i.test.line }}</code></li>
        <li v-for="s in stale" :key="s.pathId + s.locale"><strong>Smoke</strong> validation périmée pour {{ s.pathLabel }} / {{ s.locale }}</li>
        <li v-for="t in props.ui.orphanTemplates" :key="t"><strong>Gabarit</strong> <code>{{ t }}</code> n'est envoyé par aucun e-mail du BPMN</li>
        <li v-for="w in props.ui.warnings" :key="w"><strong>Avertissement</strong> {{ w }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.tracking { display: flex; flex-direction: column; gap: 16px; }
.small { font-size: 12px; }
.warn { color: var(--traversed); }
.inline { display: flex; gap: 8px; align-items: center; }
.inline input { background: var(--ink); color: var(--text); border: 1px solid var(--rule); border-radius: 6px; padding: 4px 8px; font: inherit; font-family: var(--font-mono); width: 220px; }
.clean { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
</style>
