<script setup lang="ts">
import { computed } from 'vue';
import type { JourneyStatus } from '../../core/contract';
import { indicators, sinceVisit, suggestedActions, trend, type Indicators, type QuickWinStep } from '../../core/indicators';
import ChartFrame from '../components/ChartFrame.vue';
import { dateFr, pct } from '../components/chart';
import EffortScatter from '../components/EffortScatter.vue';
import FunnelChart from '../components/FunnelChart.vue';
import HistogramChart from '../components/HistogramChart.vue';
import Kpi from '../components/Kpi.vue';
import LineChart, { type Series } from '../components/LineChart.vue';
import { journeyVersions, loadAll, store } from '../store';

const emit = defineEmits<{ open: [journey: string] }>();

const STATUS_LABEL: Record<JourneyStatus, string> = { ready: 'prêt', incomplete: 'sources absentes', invalid: 'config invalide' };
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

const journeys = computed(() => store.journeys?.journeys ?? []);
const label = (id: string) => journeys.value.find((j) => j.id === id)?.label ?? id;

/** Indicateurs de la suite UI de chaque parcours qui a une vue. */
const perJourney = computed(() =>
  journeys.value
    .map((j) => ({ id: j.id, state: store.byJourney[j.id] }))
    .filter((x): x is { id: string; state: NonNullable<typeof x.state> } => !!x.state?.views.ui)
    .map((x) => ({ id: x.id, updating: x.state.updating, ind: indicators(x.state.views.ui!), history: x.state.history.ui ?? [] })),
);
const anyUpdating = computed(() => perJourney.value.some((j) => j.updating));

const total = computed(() => {
  const sum = (f: (i: Indicators) => number) => perJourney.value.reduce((n, j) => n + f(j.ind), 0);
  const cells = sum((i) => i.cells);
  const reached = sum((i) => i.reached);
  const covered = sum((i) => i.covered);
  return {
    cells,
    reached,
    covered,
    coverage: cells ? reached / cells : null,
    verification: cells ? covered / cells : null,
    illusion: reached ? (reached - covered) / reached : null,
    quick: sum((i) => i.quickWins.cells),
    grey: sum((i) => i.grey.total),
    fragile: sum((i) => i.fragile.length),
  };
});

const funnel = computed(() => [
  { label: 'Cellules', value: total.value.cells, hint: 'écrans et e-mails × langues du périmètre' },
  { label: 'Atteintes', value: total.value.reached, hint: 'au moins un test passe par la cellule' },
  { label: 'Capturées', value: total.value.covered, hint: 'au moins un test la vérifie par une capture' },
]);

const effortCells = computed(() => perJourney.value.flatMap((j) => j.ind.effort.perCell));
const histogram = computed(() => {
  const buckets = perJourney.value[0]?.ind.histogram.map((b) => ({ ...b, count: 0 })) ?? [];
  for (const j of perJourney.value) j.ind.histogram.forEach((b, i) => (buckets[i]!.count += b.count));
  return buckets;
});

/** Courbe de gain : plans gloutons de chaque parcours fusionnés par gain décroissant. */
const gainPlan = computed(() =>
  perJourney.value
    .flatMap((j) => j.ind.quickWins.plan.map((s) => ({ journey: j.id, step: s })))
    .sort((a, b) => b.step.cells.length - a.step.cells.length),
);
const gainSeries = computed<Series[]>(() => {
  const t = total.value;
  if (!t.cells) return [];
  let covered = t.covered;
  const points = [{ x: 0, y: covered / t.cells }];
  gainPlan.value.forEach((g, i) => {
    covered += g.step.cells.length;
    points.push({ x: i + 1, y: covered / t.cells });
  });
  return [{ name: 'Vérification', color: 'var(--series-1)', points }];
});
const testName = (s: QuickWinStep) => s.test.id.split(' › ').at(-1);

const actions = computed(() => perJourney.value.flatMap((j) => suggestedActions(j.id, j.ind)).sort((a, b) => b.weight - a.weight).slice(0, 8));

const evolution = computed<Series[]>(() => {
  const shown = perJourney.value.slice(0, 3);
  if (shown.length === 1) {
    const t = trend(shown[0]!.history);
    return [
      { name: 'Couverture', color: 'var(--series-1)', points: t.map((p) => ({ x: Date.parse(p.at), y: p.coverage })) },
      { name: 'Vérification', color: 'var(--series-2)', points: t.map((p) => ({ x: Date.parse(p.at), y: p.verification })) },
    ];
  }
  return shown.map((j, i) => ({ name: label(j.id), color: SERIES[i]!, points: trend(j.history).map((p) => ({ x: Date.parse(p.at), y: p.coverage })) }));
});
const ranking = computed(() =>
  perJourney.value
    .map((j) => {
      const t = trend(j.history);
      const first = t[0]?.coverage ?? null;
      const now = j.ind.coverage;
      return { id: j.id, now, verification: j.ind.verification, delta: first !== null && now !== null ? now - first : null, points: t.length };
    })
    .sort((a, b) => (b.now ?? -1) - (a.now ?? -1)),
);

const since = computed(() =>
  perJourney.value.map((j) => ({ id: j.id, d: sinceVisit(j.history, store.previousVisit) })).filter((x) => x.d.improved.length || x.d.worsened.length || x.d.added.length || x.d.removed.length),
);
</script>

<template>
  <section class="overview">
    <div class="head">
      <h2>Vue d'ensemble</h2>
      <span class="muted status">
        <template v-if="anyUpdating"><span class="updating">mise à jour…</span></template>
        <template v-else-if="perJourney.length">suite UI · {{ perJourney.length }} parcours</template>
      </span>
      <button class="ghost" :disabled="store.loading" @click="loadAll">{{ store.loading ? 'Lecture…' : 'Relire' }}</button>
    </div>
    <p v-if="store.error" class="error" role="alert">{{ store.error }}</p>

    <div class="since card" :class="{ stale: anyUpdating }">
      <strong>Depuis ta dernière visite</strong>
      <span v-if="!store.previousVisit" class="muted"> — première visite : rien à comparer.</span>
      <template v-else>
        <span class="muted"> ({{ dateFr(store.previousVisit, true) }})</span>
        <span v-if="!since.length"> — rien n'a bougé.</span>
        <ul v-else>
          <li v-for="s in since" :key="s.id">
            <button class="link" @click="emit('open', s.id)">{{ label(s.id) }}</button> :
            <span v-if="s.d.improved.length" class="up">+{{ s.d.improved.length }} cellule{{ s.d.improved.length > 1 ? 's progressent' : ' progresse' }}</span>
            <span v-if="s.d.worsened.length" class="down"> −{{ s.d.worsened.length }} régresse{{ s.d.worsened.length > 1 ? 'nt' : '' }}</span>
            <span v-if="s.d.added.length" class="muted"> · {{ s.d.added.length }} nouvelle{{ s.d.added.length > 1 ? 's' : '' }}</span>
            <span v-if="s.d.removed.length" class="muted"> · {{ s.d.removed.length }} disparue{{ s.d.removed.length > 1 ? 's' : '' }}</span>
          </li>
        </ul>
      </template>
    </div>

    <div class="kpis">
      <Kpi label="Couverture" :value="total.coverage" format="pct" :detail="`${total.reached} / ${total.cells} cellules atteintes`" :stale="anyUpdating" hint="Cellules atteintes par au moins un test / cellules" />
      <Kpi label="Vérification" :value="total.verification" format="pct" :detail="`${total.covered} cellules capturées`" :stale="anyUpdating" hint="Cellules capturées / cellules" />
      <Kpi label="Illusion" :value="total.illusion" format="pct" detail="atteintes, jamais capturées" :stale="anyUpdating" hint="Cellules atteintes jamais capturées / cellules atteintes" />
      <Kpi label="Gains rapides" :value="total.quick" format="int" :detail="`cellules en ${gainPlan.length} test${gainPlan.length > 1 ? 's' : ''} retouché${gainPlan.length > 1 ? 's' : ''}`" :stale="anyUpdating" hint="Cellules déjà traversées qu'une capture suffirait à vérifier" />
      <Kpi label="Zone grise" :value="total.grey" format="int" detail="comptée nulle part" :stale="anyUpdating" hint="Ambiguïtés, e-mails non attribués, éléments BPMN sans lien, langues inconnues" />
    </div>

    <div class="grid two">
      <ChartFrame title="Entonnoir de couverture" lede="Des cellules du périmètre à celles qu'un test vérifie vraiment.">
        <FunnelChart :stages="funnel" />
        <template #table>
          <table class="data"><thead><tr><th>Étape</th><th class="r">Cellules</th><th class="r">Part</th></tr></thead>
            <tbody><tr v-for="s in funnel" :key="s.label"><td>{{ s.label }}</td><td class="r num">{{ s.value }}</td><td class="r num">{{ pct(total.cells ? s.value / total.cells : null) }}</td></tr></tbody>
          </table>
        </template>
      </ChartFrame>
      <section class="card">
        <h3>Actions suggérées</h3>
        <p class="lede">Ce qui rapporte le plus, d'après la vue actuelle.</p>
        <p v-if="!actions.length" class="muted">Rien à proposer.</p>
        <ol class="actions">
          <li v-for="(a, i) in actions" :key="i" :class="a.kind">
            <span class="kind">{{ { 'quick-win': 'Gain rapide', fragile: 'Fragilité', language: 'Langue', grey: 'Zone grise' }[a.kind] }}</span>
            <span>{{ a.text }}</span>
            <button class="link" @click="emit('open', a.journey)">{{ label(a.journey) }}</button>
          </li>
        </ol>
      </section>
    </div>

    <div class="grid three">
      <ChartFrame title="Effort" lede="Tests par cellule d'écran contre captures. Un gros point en bas = beaucoup de passages, aucune preuve.">
        <EffortScatter :cells="effortCells" />
        <template #table>
          <table class="data"><thead><tr><th>Cellule</th><th>Langue</th><th class="r">Tests</th><th class="r">Captures</th><th>Type</th></tr></thead>
            <tbody><tr v-for="c in effortCells" :key="c.ref + c.locale"><td><code>{{ c.ref }}</code></td><td>{{ c.locale }}</td><td class="r num">{{ c.tests }}</td><td class="r num">{{ c.captures }}</td><td>{{ c.isError ? 'erreur' : 'nominal' }}</td></tr></tbody>
          </table>
        </template>
      </ChartFrame>
      <ChartFrame title="Tests par cellule" lede="Combien de tests passent par chaque cellule d'écran. « 1 » = fragile.">
        <HistogramChart :buckets="histogram" />
        <template #table>
          <table class="data"><thead><tr><th>Tests</th><th class="r">Cellules</th></tr></thead>
            <tbody><tr v-for="b in histogram" :key="b.bucket"><td>{{ b.bucket }}</td><td class="r num">{{ b.count }}</td></tr></tbody>
          </table>
        </template>
      </ChartFrame>
      <ChartFrame title="Courbe de gain" lede="Vérification obtenue en ajoutant des captures, test par test, dans l'ordre le plus rentable.">
        <LineChart v-if="gainSeries.length" :series="gainSeries" x-kind="int" x-label="tests retouchés :" step :width="360" />
        <template #table>
          <table class="data"><thead><tr><th>#</th><th>Test</th><th class="r">Cellules</th></tr></thead>
            <tbody><tr v-for="(g, i) in gainPlan" :key="i"><td class="num">{{ i + 1 }}</td><td>{{ testName(g.step) }}</td><td class="r num">+{{ g.step.cells.length }}</td></tr></tbody>
          </table>
        </template>
      </ChartFrame>
    </div>

    <div class="grid two">
      <ChartFrame title="Évolution" :lede="perJourney.length === 1 ? 'Une mesure par analyse qui a changé la couverture.' : 'Couverture de chaque parcours (trois au plus ; le reste dans le tableau).'">
        <LineChart v-if="evolution.some((s) => s.points.length > 1)" :series="evolution" x-kind="date" />
        <p v-else-if="evolution.some((s) => s.points.length === 1)" class="muted">Une seule mesure pour l'instant : la courbe apparaîtra quand la couverture aura changé.</p>
        <p v-else class="muted">Pas encore d'historique.</p>
        <template #table>
          <table class="data"><thead><tr><th>Parcours</th><th>Date</th><th class="r">Couverture</th><th class="r">Vérification</th></tr></thead>
            <tbody>
              <template v-for="j in perJourney" :key="j.id">
                <tr v-for="p in trend(j.history)" :key="p.at"><td>{{ label(j.id) }}</td><td class="num">{{ dateFr(p.at, true) }}</td><td class="r num">{{ pct(p.coverage) }}</td><td class="r num">{{ pct(p.verification) }}</td></tr>
              </template>
            </tbody>
          </table>
        </template>
      </ChartFrame>
      <section class="card">
        <h3>Classement</h3>
        <p class="lede">Par couverture ; écart depuis la première mesure.</p>
        <table class="data">
          <thead><tr><th>Parcours</th><th class="r">Couverture</th><th class="r">Vérification</th><th class="r">Écart</th></tr></thead>
          <tbody>
            <tr v-for="r in ranking" :key="r.id">
              <td><button class="link" @click="emit('open', r.id)">{{ label(r.id) }}</button></td>
              <td class="r num">{{ pct(r.now) }}</td>
              <td class="r num">{{ pct(r.verification) }}</td>
              <td class="r num" :class="{ up: (r.delta ?? 0) > 0, down: (r.delta ?? 0) < 0 }">
                {{ r.delta === null || r.points < 2 ? '—' : `${r.delta > 0 ? '+' : ''}${Math.round(r.delta * 100)} pts` }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <section class="card">
      <h3>Parcours configurés</h3>
      <table class="data">
        <thead><tr><th>Parcours</th><th>État</th><th>Langues</th><th>Sources</th><th class="r">Couverture</th><th class="r">Vérification</th><th class="r">Zone grise</th><th>Analyse</th></tr></thead>
        <tbody>
          <tr v-for="j in journeys" :key="j.id">
            <td>
              <button class="link name" @click="emit('open', j.id)">{{ j.label }}</button> <span v-if="j.pilot" class="tag">pilote</span>
              <span v-if="journeyVersions(j.id)?.newSinceSeen.length" class="tag new" :title="`Non vues : ${journeyVersions(j.id)!.newSinceSeen.join(', ')}`">
                {{ journeyVersions(j.id)!.newSinceSeen.length }} nouvelle{{ journeyVersions(j.id)!.newSinceSeen.length > 1 ? 's' : '' }} version{{ journeyVersions(j.id)!.newSinceSeen.length > 1 ? 's' : '' }}
              </span>
              <div><code class="muted small">{{ j.id }}</code></div>
            </td>
            <td><span class="dot" :class="j.status" />{{ STATUS_LABEL[j.status] }}</td>
            <td class="num">{{ j.locales.join(' · ') }}</td>
            <td class="sources">
              <span :class="{ ok: j.bpmnDir.exists }" :title="j.bpmnDir.path">BPMN</span>
              <span :class="{ ok: j.frontPackage.exists }" :title="j.frontPackage.path">Front</span>
              <span :class="{ ok: j.specs.every((s) => s.exists) }">Specs {{ j.specs.filter((s) => s.exists).length }}/{{ j.specs.length }}</span>
            </td>
            <template v-if="perJourney.find((p) => p.id === j.id)">
              <td class="r num" :class="{ stale: store.byJourney[j.id]?.updating }">{{ pct(perJourney.find((p) => p.id === j.id)!.ind.coverage) }}</td>
              <td class="r num" :class="{ stale: store.byJourney[j.id]?.updating }">{{ pct(perJourney.find((p) => p.id === j.id)!.ind.verification) }}</td>
              <td class="r num" :class="{ stale: store.byJourney[j.id]?.updating }">{{ perJourney.find((p) => p.id === j.id)!.ind.grey.total }}</td>
            </template>
            <td v-else colspan="3" class="muted">{{ j.status === 'ready' ? 'analyse…' : '—' }}</td>
            <td class="muted small">
              <span v-if="store.byJourney[j.id]?.updating" class="updating">mise à jour…</span>
              <span v-else-if="store.byJourney[j.id]?.error" class="error" :title="store.byJourney[j.id]?.error">échec</span>
              <span v-else-if="store.byJourney[j.id]?.at">{{ dateFr(store.byJourney[j.id]!.at!, true) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <template v-for="r in (store.journeys?.repos ?? []).filter((x) => !x.exists)" :key="r.key">
        <p class="muted small">Dépôt introuvable : <code>{{ r.envVar }}</code> → <code>{{ r.path }}</code></p>
      </template>
    </section>
  </section>
</template>

<style scoped>
.overview { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: baseline; gap: 16px; }
.head h2 { flex: 0 0 auto; }
.status { flex: 1; font-size: 12px; }
.updating { color: var(--traversed); }
.since ul { margin: 6px 0 0; padding-left: 18px; }
.up { color: var(--covered); }
.down { color: var(--missing); }
.kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.grid { display: grid; gap: 16px; }
.two { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 1100px) {
  .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .two, .three { grid-template-columns: minmax(0, 1fr); }
}
.actions { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.actions li { display: grid; grid-template-columns: 92px 1fr auto; gap: 10px; align-items: baseline; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }
.kind { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.name { font-weight: 500; color: var(--text); }
.tag { font-size: 11px; color: var(--accent); border: 1px solid currentColor; border-radius: 3px; padding: 0 4px; }
.tag.new { color: var(--traversed); }
.small { font-size: 12px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.dot.ready { background: var(--covered); }
.dot.incomplete { background: var(--traversed); }
.dot.invalid { background: var(--missing); }
.sources { display: flex; gap: 10px; color: var(--grey); }
.sources .ok { color: var(--text-2); }
</style>
