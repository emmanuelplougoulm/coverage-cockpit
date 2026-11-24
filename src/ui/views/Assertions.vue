<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AssertionAudit, FactStatus } from '../../core/knowledge';
import Kpi from '../components/Kpi.vue';
import { auditStore, loadAudit, store } from '../store';

/**
 * Assertions (§14, suite workflow) : ce que les tests prouvent (contrôles),
 * par couche, intention et brique ; puis chaque fait du BPMN. Les gardes sont
 * comptées, jamais montrées comme preuves.
 */
const props = defineProps<{ journey: string }>();
const error = ref<string | null>(null);
watch(
  () => props.journey,
  async (id) => {
    error.value = null;
    try {
      await loadAudit(id);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  },
  { immediate: true },
);
const audit = computed<AssertionAudit | undefined>(() => auditStore.byJourney[props.journey]);
const bricks = computed(() => new Map((store.byJourney[props.journey]?.views.workflow?.bricks ?? []).map((b) => [b.ref, b])));
const brickLabel = (id: string | null) => (id ? id : 'à classer');
const testName = (id: string) => id.split(' › ').at(-1);
const FACT: Record<FactStatus, { shape: string; label: string; cls: string }> = {
  controlled: { shape: '●', label: 'contrôlé', cls: 'covered' },
  reached: { shape: '◐', label: 'atteint', cls: 'traversed' },
  missing: { shape: '○', label: 'manquant', cls: 'missing' },
  excluded: { shape: '⊘', label: 'exclu', cls: 'grey' },
  unlinked: { shape: '?', label: 'sans lien', cls: 'grey' },
};
const LAYERS = ['MO', 'Client', 'Document', 'API', 'E-mail', 'Test', '?'];
const sessionsWithBrick = computed(() => [...bricks.value.values()].filter((b) => !b.ref.includes('.') && !b.ref.startsWith('bpmn:')));
</script>

<template>
  <div class="assertions">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="!audit && !error" class="muted">Audit en cours…</p>
    <template v-if="audit">
      <p class="muted small">Audit lu sur la suite workflow (contrôles back-office, API, document, e-mail). On compare la forme des contrôles, pas les valeurs attendues.</p>
      <div class="kpis">
        <Kpi label="Faits contrôlés" :value="audit.rate.total ? audit.rate.controlled / audit.rate.total : null" format="pct" :detail="`${audit.rate.controlled} / ${audit.rate.total} · majorant`" hint="Lien fait par test, pas par étape : c'est un majorant. Faits exclus et sans lien hors total." />
        <Kpi label="Faits atteints" :value="audit.rate.total ? audit.rate.reached / audit.rate.total : null" format="pct" :detail="`${audit.rate.reached} / ${audit.rate.total}`" />
        <Kpi label="Contrôles" :value="audit.controls.length" format="int" :detail="`${audit.controls.filter((c) => c.strength === 'valeur').length} sur une valeur`" />
        <Kpi label="Gardes" :value="audit.guards" format="int" detail="attentes des actions, pas des preuves" />
      </div>

      <section class="card">
        <h3>Faits du BPMN</h3>
        <p class="lede">Contrôlé : un test qui atteint le fait contrôle chaque intention attendue (bpmn-expectations.yaml). Sans attente, l'atteindre suffit.</p>
        <table class="data">
          <thead><tr><th>Fait</th><th>Brique</th><th>État</th><th>Attendu</th><th>Contrôlé par</th><th>Seulement traversé par</th></tr></thead>
          <tbody>
            <tr v-for="f in audit.facts" :key="f.id">
              <td><code>{{ f.id }}</code><div class="muted small">{{ { session: 'session', email: 'e-mail', branch: 'branche' }[f.kind] }} · {{ f.label }}</div></td>
              <td class="small">{{ brickLabel(f.brick) }}</td>
              <td class="small nowrap"><span :class="FACT[f.status].cls">{{ FACT[f.status].shape }}</span> {{ FACT[f.status].label }}<div v-if="f.reason" class="muted">{{ f.reason }}</div></td>
              <td class="small">
                <span v-if="!f.expected.length" class="muted">l'atteindre suffit</span>
                <div v-for="e in f.expected" :key="e.id" :class="{ miss: f.missingIntentions.includes(e.id) }">{{ e.label }} <span class="muted">({{ e.layer }})</span></div>
              </td>
              <td class="small"><div v-for="(tests, id) in f.controlledBy" :key="id"><template v-for="t in tests" :key="t">{{ testName(t) }}<br /></template></div></td>
              <td class="small warn"><div v-for="t in f.traversedOnly" :key="t">{{ testName(t) }}</div></td>
            </tr>
          </tbody>
        </table>
      </section>

      <div class="grid two">
        <section class="card">
          <h3>Contrôles par couche</h3>
          <table class="data">
            <thead><tr><th>Couche</th><th class="r">Contrôles</th><th class="r">Valeur</th><th class="r">Présence</th><th class="r">Visuel</th></tr></thead>
            <tbody>
              <tr v-for="l in LAYERS.filter((x) => audit!.byLayer[x])" :key="l">
                <td>{{ l === '?' ? 'à classer' : l }}</td>
                <td class="r num">{{ audit.byLayer[l]!.count }}</td>
                <td class="r num">{{ audit.byLayer[l]!.valeur }}</td>
                <td class="r num">{{ audit.byLayer[l]!.presence }}</td>
                <td class="r num">{{ audit.byLayer[l]!.visuel }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="card">
          <h3>Intentions (motifs de contrôle)</h3>
          <table class="data">
            <thead><tr><th>Intention</th><th>Brique</th><th>Couche</th><th>Vue</th></tr></thead>
            <tbody>
              <tr v-for="i in audit.intentions" :key="i.id">
                <td>{{ i.label }}<span v-if="i.core" class="tag">cœur</span></td>
                <td class="small">{{ i.brick }}</td>
                <td class="small">{{ i.layer }}</td>
                <td class="small"><template v-if="i.tests.length">● {{ i.tests.length }} test{{ i.tests.length > 1 ? 's' : '' }}</template><span v-else class="miss">○ jamais</span></td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <section class="card">
        <h3>Contrôles par test</h3>
        <table class="data">
          <thead><tr><th>Test</th><th>Contrôle</th><th>Force</th><th>Couche</th><th>Intentions</th></tr></thead>
          <tbody>
            <tr v-for="(c, i) in audit.controls" :key="i">
              <td class="small">{{ testName(c.test.id) }}</td>
              <td><code>{{ c.check }}</code></td>
              <td class="small">{{ c.strength }}</td>
              <td class="small">{{ c.layer ?? 'à classer' }}</td>
              <td class="small">{{ c.intentions.join(', ') || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h3>Briques des sessions</h3>
        <p class="lede">business-bricks.yaml : premier match gagne ; le reste est à classer.</p>
        <ul class="bricks small">
          <li v-for="b in sessionsWithBrick" :key="b.ref"><code>{{ b.ref }}</code> → {{ brickLabel(b.brick) }}<span v-if="b.confidence" class="muted"> ({{ b.confidence }}{{ b.note ? ` · ${b.note}` : '' }})</span></li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.assertions { display: flex; flex-direction: column; gap: 16px; }
.small { font-size: 12px; }
.nowrap { white-space: nowrap; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.grid.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.covered { color: var(--covered); }
.traversed { color: var(--traversed); }
.missing { color: var(--missing); }
.grey { color: var(--grey); }
.miss { color: var(--missing); }
.warn { color: var(--traversed); }
.tag { font-size: 10px; text-transform: uppercase; color: var(--muted); border: 1px solid var(--rule); border-radius: 3px; padding: 0 4px; margin-left: 6px; }
.bricks { columns: 2; margin: 0; padding-left: 18px; }
</style>
