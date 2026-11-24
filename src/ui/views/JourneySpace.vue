<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import type { CaptureRef, CoverageView, StateCoverage, Suite } from '../../core/coverage';
import { indicators, trend } from '../../core/indicators';
import ChartFrame from '../components/ChartFrame.vue';
import { dateFr, pct } from '../components/chart';
import Kpi from '../components/Kpi.vue';
import LineChart, { type Series } from '../components/LineChart.vue';
import Sketch from '../components/Sketch.vue';
import StatusChip from '../components/StatusChip.vue';
import Viewer, { type ViewerItem } from '../components/Viewer.vue';
import { bpmnXml, runsStore, ensureDecisions, ensureMedia, ensureSuite, fullImage, imagesAllowed, inTauri, openImage, refresh, store } from '../store';
import BpmnDiagram from '../components/BpmnDiagram.vue';
import type { CellStatus } from '../../core/fixture';
import Assertions from './Assertions.vue';
import CapturesDialog from '../components/CapturesDialog.vue';
import NewTest from './NewTest.vue';
import Onboarding from './Onboarding.vue';
import JourneyVersions from './JourneyVersions.vue';
import Register from './Register.vue';
import Tracking from './Tracking.vue';

const props = defineProps<{ journey: string; suite: Suite; sub: string }>();
const emit = defineEmits<{ journey: [id: string]; suite: [s: Suite]; sub: [s: string] }>();

const SUBS: { id: string; label: string; milestone?: number }[] = [
  { id: 'coverage', label: 'Couverture' },
  { id: 'gallery', label: 'Galerie' },
  { id: 'tracking', label: 'Suivi' },
  { id: 'assertions', label: 'Assertions' },
  { id: 'bpmn', label: 'BPMN' },
  { id: 'versions', label: 'Versions' },
  { id: 'new-test', label: 'Nouveau test' },
  { id: 'onboarding', label: 'Onboarding' },
];

const journeys = computed(() => store.journeys?.journeys ?? []);
const st = computed(() => store.byJourney[props.journey]);
const view = computed<CoverageView | undefined>(() => st.value?.views[props.suite]);
const ind = computed(() => (view.value ? indicators(view.value) : null));
const mediaError = ref<string | null>(null);

watch(
  () => [props.journey, props.suite] as const,
  async ([id, suite]) => {
    await ensureSuite(id, suite);
    // Le registre réunit les e-mails des deux suites.
    if (suite === 'ui') void ensureSuite(id, 'workflow');
    void ensureDecisions(id);
    mediaError.value = null;
    ensureMedia(id).catch((e) => (mediaError.value = e instanceof Error ? e.message : String(e)));
  },
  { immediate: true },
);

const thumbs = computed(() => new Map((st.value?.thumbnails?.thumbnails ?? []).map((t) => [t.image, t.thumb])));
const texts = computed(() => st.value?.sketches?.texts ?? {});
const duplicates = computed(() => st.value?.thumbnails?.duplicates ?? []);

const coverageMode = ref<'register' | 'sessions'>('register');
const showCaptures = ref(false);
/** « Écrire » / « Compléter » dans le registre : la demande va dans « Nouveau test ». */
function writeTest(text: string) {
  runsStore.draftRequest[props.journey] = text;
  emit('sub', 'new-test');
}

// ——— onglet BPMN : diagramme coloré par statut ———
const xml = ref<{ xml: string; generated: boolean } | null>(null);
const xmlError = ref<string | null>(null);
const focus = ref<string | null>(null);
/** Recentre même si l'élément était déjà ciblé. */
async function focusElement(id: string) {
  focus.value = null;
  await nextTick();
  focus.value = id;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
watch(
  () => [props.journey, props.sub] as const,
  async ([id, sub]) => {
    if (sub !== 'bpmn') return;
    xml.value = null;
    xmlError.value = null;
    try {
      xml.value = await bpmnXml(id);
    } catch (e) {
      xmlError.value = e instanceof Error ? e.message : String(e);
    }
  },
  { immediate: true },
);
/** Statut par élément du diagramme : sessions (sous-processus), e-mails (tâche), branches (flux). */
const diagramStatuses = computed<Record<string, CellStatus>>(() =>
  Object.fromEntries((view.value?.bpmn ?? []).map((b) => [b.kind === 'branch' ? b.id.slice(b.id.lastIndexOf('/') + 1) : b.id, b.status])),
);
const journeyRef = computed(() => ({ id: props.journey, label: journeys.value.find((j) => j.id === props.journey)?.label ?? props.journey }));
const open = reactive(new Set<string>());
const toggle = (k: string) => (open.has(k) ? open.delete(k) : open.add(k));
const testName = (id: string) => id.split(' › ').at(-1);
const firstImage = (s: StateCoverage): CaptureRef | undefined =>
  Object.values(s.byLocale).flatMap((c) => c.capturedBy).find((c) => c.image);
const sessionCounts = (states: StateCoverage[]) => {
  const cells = states.flatMap((s) => Object.values(s.byLocale));
  return { total: cells.length, reached: cells.filter((c) => c.status !== 'missing').length, covered: cells.filter((c) => c.status === 'covered').length };
};

const grey = computed(() => {
  const v = view.value;
  if (!v) return 0;
  return v.ambiguous.length + v.unattributed.length + v.unknownLocaleTests.length + v.bpmn.filter((b) => b.status === 'unlinked').length;
});
const showGrey = ref(false);

const history = computed<Series[]>(() => {
  const t = trend(st.value?.history[props.suite] ?? []);
  return [
    { name: 'Couverture', color: 'var(--series-1)', points: t.map((p) => ({ x: Date.parse(p.at), y: p.coverage })) },
    { name: 'Vérification', color: 'var(--series-2)', points: t.map((p) => ({ x: Date.parse(p.at), y: p.verification })) },
  ];
});

// ——— galerie ———
const galleryLocale = ref<string>('toutes');
const galleryFilter = ref<'all' | 'captured' | 'not'>('all');
interface Tile {
  key: string;
  ref: string;
  label: string;
  locale: string;
  status: 'missing' | 'traversed' | 'covered';
  capture?: CaptureRef;
}
const tiles = computed<Tile[]>(() => {
  const v = view.value;
  if (!v) return [];
  const out: Tile[] = [];
  for (const s of v.sessions) {
    for (const stt of s.states) {
      for (const [loc, c] of Object.entries(stt.byLocale)) {
        const ref = `${stt.group}.${stt.key}`;
        out.push({ key: `${ref}|${loc}`, ref, label: `${s.label} › ${stt.key}`, locale: loc, status: c.status, ...(c.capturedBy[0] ? { capture: c.capturedBy.find((x) => x.image) ?? c.capturedBy[0] } : {}) });
      }
    }
  }
  for (const e of v.emails) {
    for (const va of e.variants) {
      for (const [loc, c] of Object.entries(va.byLocale)) {
        out.push({ key: `email:${e.template}/${va.variant}|${loc}`, ref: `email:${e.template}/${va.variant}`, label: `E-mail › ${e.template} (${va.variant})`, locale: loc, status: c.status, ...(c.capturedBy[0] ? { capture: c.capturedBy.find((x) => x.image) ?? c.capturedBy[0] } : {}) });
      }
    }
  }
  return out.filter(
    (t) =>
      (galleryLocale.value === 'toutes' || t.locale === galleryLocale.value) &&
      (galleryFilter.value === 'all' || (galleryFilter.value === 'captured') === (t.status === 'covered')),
  );
});
const withImage = computed(() => tiles.value.filter((t) => t.capture?.image));

const viewer = ref<{ items: ViewerItem[]; start: number } | null>(null);
function openViewer(image: string) {
  const items = withImage.value.map<ViewerItem>((t) => ({
    title: t.label,
    subtitle: `${t.locale} · ${testName(t.capture!.id)} · ${t.capture!.image}`,
    load: () => fullImage(props.journey, t.capture!.image!),
    ...(inTauri() ? { open: () => void openImage(props.journey, t.capture!.image!) } : {}),
  }));
  const start = Math.max(0, withImage.value.findIndex((t) => t.capture!.image === image));
  if (!imagesAllowed()) return;
  viewer.value = { items, start };
}
</script>

<template>
  <section class="space">
    <div class="head">
      <label class="switcher">
        <span class="sr">Parcours</span>
        <select :value="props.journey" @change="emit('journey', ($event.target as HTMLSelectElement).value)">
          <option v-for="j in journeys" :key="j.id" :value="j.id">{{ j.label }}</option>
        </select>
      </label>
      <div class="seg" role="group" aria-label="Suite">
        <button :class="{ on: props.suite === 'ui' }" :aria-pressed="props.suite === 'ui'" @click="emit('suite', 'ui')">Suite UI</button>
        <button :class="{ on: props.suite === 'workflow' }" :aria-pressed="props.suite === 'workflow'" @click="emit('suite', 'workflow')">Suite workflow</button>
      </div>
      <span class="muted small cache">
        <span v-if="st?.updating" class="updating">mise à jour…</span>
        <template v-else-if="st?.cache">analysé le {{ dateFr(st.cache.analyzedAt, true) }} · cache {{ { hit: 'à jour', inputs: 'à jour (entrées inchangées)', miss: 'recalculé', forced: 'forcé' }[st.cache.status] }}</template>
      </span>
      <button class="ghost" :disabled="st?.updating" @click="refresh(props.journey, props.suite, true)">Réanalyser</button>
    </div>

    <nav class="subs" aria-label="Onglets du parcours">
      <button v-for="s in SUBS" :key="s.id" :class="{ on: s.id === props.sub }" :aria-current="s.id === props.sub ? 'page' : undefined" @click="emit('sub', s.id)">
        {{ s.label }}<span v-if="s.milestone" class="ms">j{{ s.milestone }}</span>
      </button>
    </nav>

    <p v-if="st?.error" class="error" role="alert">{{ st.error }}</p>
    <p v-if="!view" class="muted">Chargement de la vue…</p>

    <template v-else-if="props.sub === 'coverage' || props.sub === 'gallery'">
      <div class="kpis" :class="{ stale: st?.updating }">
        <Kpi label="Couverture" :value="ind!.coverage" format="pct" :detail="`${ind!.reached} / ${ind!.cells} cellules`" />
        <Kpi label="Vérification" :value="ind!.verification" format="pct" :detail="`${ind!.covered} capturées`" />
        <Kpi label="Illusion" :value="ind!.illusion" format="pct" detail="atteintes, jamais capturées" />
        <Kpi label="Tests" :value="view.testsScanned" format="int" :detail="`rattachés · ${view.excluded.filter((e) => e.reason.startsWith('spec partagée')).length} écarté(s)`" />
      </div>

      <div v-if="grey" class="grey card">
        <button class="link" :aria-expanded="showGrey" @click="showGrey = !showGrey">
          Zone grise : {{ grey }} élément{{ grey > 1 ? 's' : '' }} que l'outil ne peut pas trancher, comptés nulle part
        </button>
        <div v-if="showGrey" class="grey-list">
          <div v-for="a in view.ambiguous" :key="a.marker + a.candidates.join()">
            <strong>Ambigu</strong> <code>{{ a.marker }}</code> → {{ a.candidates.join(' ou ') }} <span class="muted">({{ a.tests.map((t) => testName(t.id)).join(', ') }})</span>
          </div>
          <div v-for="u in view.unattributed" :key="u.reason + u.subject">
            <strong>E-mail non attribué</strong> « {{ u.subject }} » —
            {{ { 'shared-subject': 'objet partagé par ' + u.templates.join(', '), 'unknown-subject': 'objet inconnu du BPMN', variant: 'variante impossible à trancher (' + u.templates.join(', ') + ')' }[u.reason] }}
          </div>
          <div v-for="t in view.unknownLocaleTests" :key="t.id"><strong>Langue inconnue</strong> {{ testName(t.id) }} <code class="muted">{{ t.file }}:{{ t.line }}</code></div>
          <div v-for="b in view.bpmn.filter((x) => x.status === 'unlinked')" :key="b.id"><strong>Sans lien</strong> <code>{{ b.id }}</code> — {{ b.reason }}</div>
        </div>
      </div>
      <div v-if="duplicates.length && props.suite === 'ui'" class="notice card">
        <strong>Doublons de rendu</strong> —
        <span v-for="d in duplicates" :key="d.hash"> {{ d.refs.join(' et ') }} ont la même capture.</span>
      </div>

      <div v-if="props.sub === 'coverage'" class="mode-row">
        <div class="seg mode" role="group" aria-label="Présentation">
          <button :class="{ on: coverageMode === 'register' }" :aria-pressed="coverageMode === 'register'" @click="coverageMode = 'register'">Registre</button>
          <button :class="{ on: coverageMode === 'sessions' }" :aria-pressed="coverageMode === 'sessions'" @click="coverageMode = 'sessions'">Par session</button>
        </div>
        <button v-if="props.suite === 'ui'" class="ghost" title="Ajouter validateUI() là où un test traverse déjà l'écran" @click="showCaptures = true">Gains rapides sans IA</button>
      </div>
      <CapturesDialog v-if="showCaptures" :journey="props.journey" @close="showCaptures = false" />

      <!-- ——— Registre par famille ——— -->
      <template v-if="props.sub === 'coverage' && coverageMode === 'register'">
        <p v-if="props.suite === 'workflow'" class="muted">Le registre se lit sur la suite UI (les e-mails de la suite workflow y sont comptés).</p>
        <Register
          v-else
          :journey="journeyRef"
          :ui="view"
          :workflow="st?.views.workflow"
          :aside="st?.decisions?.aside ?? {}"
          :validations="st?.decisions?.smoke ?? {}"
          :thumbs="thumbs"
          :texts="texts"
          @view="openViewer"
          @write="writeTest"
        />
      </template>

      <!-- ——— Couverture par session ——— -->
      <template v-else-if="props.sub === 'coverage'">
        <section v-for="s in view.sessions" :key="s.group" class="card session">
          <header>
            <h3>{{ s.label }}</h3>
            <code class="muted small">{{ s.group }}</code>
            <span class="counts num small">
              {{ sessionCounts(s.states).covered }} capturées · {{ sessionCounts(s.states).reached }} atteintes / {{ sessionCounts(s.states).total }}
            </span>
          </header>
          <table class="data states">
            <colgroup>
              <col class="c-state" /><col v-for="l in view.locales" :key="l" /><col class="c-tests" /><col class="c-cap" />
            </colgroup>
            <thead>
              <tr><th>État</th><th v-for="l in view.locales" :key="l">{{ l }}</th><th class="r">Tests</th><th>Capture</th></tr>
            </thead>
            <tbody>
              <template v-for="state in s.states" :key="state.key">
                <tr class="row" :class="{ opened: open.has(s.group + state.key) }">
                  <td>
                    <button class="link plain" :aria-expanded="open.has(s.group + state.key)" @click="toggle(s.group + state.key)">
                      <span class="caret">{{ open.has(s.group + state.key) ? '▾' : '▸' }}</span>{{ state.key }}
                    </button>
                    <span v-if="state.kind === 'message'" class="tag">message</span>
                    <div v-if="state.stepName" class="muted small"><code>step-{{ state.stepName }}</code></div>
                  </td>
                  <td v-for="l in view.locales" :key="l">
                    <StatusChip :status="state.byLocale[l]!.status" />
                    <div v-if="!state.textLocales.includes(l)" class="muted small" title="Le front n'a pas de texte pour cet état dans cette langue">sans texte</div>
                  </td>
                  <td class="r num">{{ new Set(Object.values(state.byLocale).flatMap((c) => c.tests.map((t) => t.id))).size }}</td>
                  <td>
                    <template v-if="firstImage(state)">
                      <button v-if="imagesAllowed() && thumbs.get(firstImage(state)!.image!)" class="thumb-btn" :aria-label="`Agrandir la capture de ${state.key}`" @click="openViewer(firstImage(state)!.image!)">
                        <img :src="thumbs.get(firstImage(state)!.image!)" alt="" class="mini" />
                      </button>
                      <span v-else class="muted small">{{ imagesAllowed() ? 'miniature…' : 'image masquée' }}</span>
                    </template>
                  </td>
                </tr>
                <tr v-if="open.has(s.group + state.key)" class="detail">
                  <td :colspan="view.locales.length + 3">
                    <div class="detail-grid">
                      <div v-for="l in view.locales" :key="l" class="detail-col">
                        <div class="dl-head"><strong>{{ l }}</strong> <StatusChip :status="state.byLocale[l]!.status" /></div>
                        <div v-if="!state.byLocale[l]!.tests.length" class="muted small">Aucun test n'atteint cet état dans cette langue.</div>
                        <ul class="tests">
                          <li v-for="t in state.byLocale[l]!.tests" :key="t.id">
                            {{ testName(t.id) }}
                            <span v-if="state.byLocale[l]!.capturedBy.some((c) => c.id === t.id)" class="cap">capture</span>
                            <div><code class="muted small">{{ t.file }}:{{ t.line }}</code></div>
                          </li>
                        </ul>
                        <div class="visual">
                          <template v-if="state.byLocale[l]!.capturedBy.find((c) => c.image)">
                            <button v-if="imagesAllowed() && thumbs.get(state.byLocale[l]!.capturedBy.find((c) => c.image)!.image!)" class="thumb-btn" @click="openViewer(state.byLocale[l]!.capturedBy.find((c) => c.image)!.image!)">
                              <img :src="thumbs.get(state.byLocale[l]!.capturedBy.find((c) => c.image)!.image!)" alt="Capture de référence" class="big" />
                            </button>
                            <div v-else class="masked">image masquée en aperçu de développement</div>
                          </template>
                          <Sketch v-else :texts="texts[l]?.[s.group + '.' + state.key]" :label="state.key" />
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </section>

        <section class="card">
          <h3>E-mails</h3>
          <p class="lede">Atteint = un test cherche son objet ; capturé = un test le capture.</p>
          <table class="data">
            <thead><tr><th>Gabarit</th><th>Variante</th><th>Déclencheur</th><th v-for="l in view.locales" :key="l">{{ l }}</th></tr></thead>
            <tbody>
              <template v-for="e in view.emails" :key="e.template">
                <tr v-for="(va, i) in e.variants" :key="va.variant">
                  <td><template v-if="i === 0"><code>{{ e.template }}</code><span v-if="e.missingTemplate" class="tag warn">gabarit absent du front</span></template></td>
                  <td><code class="small">{{ va.variant }}</code></td>
                  <td class="muted small">{{ i === 0 ? e.trigger : '' }}</td>
                  <td v-for="l in view.locales" :key="l">
                    <StatusChip v-if="va.byLocale[l]" :status="va.byLocale[l]!.status" />
                    <span v-else class="muted small" title="Langue fixe ou hors gabarit">—</span>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
          <p v-if="view.orphanTemplates.length" class="muted small">Gabarits que le BPMN n'envoie pas : {{ view.orphanTemplates.join(', ') }}</p>
        </section>

        <div class="grid two">
          <section class="card">
            <h3>Processus</h3>
            <p class="lede">Éléments du BPMN : exclus et sans lien hors du total.</p>
            <table class="data">
              <thead><tr><th>Élément</th><th>Type</th><th>Statut</th><th>Preuve</th></tr></thead>
              <tbody>
                <tr v-for="b in view.bpmn" :key="b.id">
                  <td><code>{{ b.id }}</code><div class="muted small">{{ b.label }}</div></td>
                  <td class="small">{{ { session: 'session', email: 'e-mail', branch: 'branche' }[b.kind] }}</td>
                  <td><StatusChip :status="b.status" /></td>
                  <td class="small"><span v-if="b.links.length">{{ b.links.length > 3 ? `${b.links.length} états` : b.links.join(', ') }}</span><span v-if="b.reason" class="muted">{{ b.reason }}</span></td>
                </tr>
              </tbody>
            </table>
          </section>
          <ChartFrame title="Évolution" lede="Une mesure par analyse qui a changé la couverture de cette suite.">
            <LineChart v-if="history[0]!.points.length > 1" :series="history" x-kind="date" />
            <p v-else-if="history[0]!.points.length === 1" class="muted">Une seule mesure pour l'instant : la courbe apparaîtra quand la couverture aura changé.</p>
            <p v-else class="muted">Pas encore d'historique.</p>
            <template #table>
              <table class="data"><thead><tr><th>Date</th><th class="r">Couverture</th><th class="r">Vérification</th></tr></thead>
                <tbody><tr v-for="p in trend(st?.history[props.suite] ?? [])" :key="p.at"><td class="num">{{ dateFr(p.at, true) }}</td><td class="r num">{{ pct(p.coverage) }}</td><td class="r num">{{ pct(p.verification) }}</td></tr></tbody>
              </table>
            </template>
          </ChartFrame>
        </div>
      </template>

      <!-- ——— Galerie ——— -->
      <template v-else>
        <div class="filters">
          <label>Langue
            <select v-model="galleryLocale"><option>toutes</option><option v-for="l in view.locales" :key="l">{{ l }}</option></select>
          </label>
          <div class="seg" role="group" aria-label="Filtre">
            <button :class="{ on: galleryFilter === 'all' }" @click="galleryFilter = 'all'">Tout</button>
            <button :class="{ on: galleryFilter === 'captured' }" @click="galleryFilter = 'captured'">Capturés</button>
            <button :class="{ on: galleryFilter === 'not' }" @click="galleryFilter = 'not'">Non capturés</button>
          </div>
          <span class="muted small">{{ tiles.length }} cellules · {{ withImage.length }} images</span>
        </div>
        <p v-if="mediaError" class="error">{{ mediaError }}</p>
        <p v-if="!imagesAllowed()" class="muted small">Images masquées en aperçu de développement (elles peuvent montrer des pièces de test).</p>
        <div class="gallery">
          <figure v-for="t in tiles" :key="t.key" class="tile">
            <button v-if="t.capture?.image && imagesAllowed() && thumbs.get(t.capture.image)" class="thumb-btn" :aria-label="`Agrandir ${t.label} (${t.locale})`" @click="openViewer(t.capture!.image!)">
              <img :src="thumbs.get(t.capture.image)" alt="" />
            </button>
            <div v-else-if="t.capture?.image" class="masked">{{ imagesAllowed() ? 'miniature…' : 'image masquée' }}</div>
            <Sketch v-else-if="!t.ref.startsWith('email:')" :texts="texts[t.locale]?.[t.ref]" :label="t.label" />
            <div v-else class="masked">e-mail sans capture</div>
            <figcaption>
              <div class="cap-title">{{ t.label }}</div>
              <div class="cap-meta"><span class="num">{{ t.locale }}</span> <StatusChip :status="t.status" /></div>
            </figcaption>
          </figure>
        </div>
      </template>
    </template>

    <template v-else-if="props.sub === 'bpmn'">
      <section class="card">
        <h3>Processus <span class="muted small">· suite {{ props.suite === 'ui' ? 'UI' : 'workflow' }}</span></h3>
        <p v-if="xmlError" class="error">{{ xmlError }}</p>
        <p v-else-if="!xml" class="muted">Chargement du BPMN…</p>
        <BpmnDiagram v-else :xml="xml.xml" :generated="xml.generated" :statuses="diagramStatuses" :focus="focus" />
      </section>
      <section class="card">
        <h3>Éléments</h3>
        <p class="lede">Cliquer un élément le centre sur le diagramme. Exclus et sans lien : hors du total.</p>
        <table class="data">
          <thead><tr><th>Élément</th><th>Type</th><th>Statut</th><th>Preuve</th></tr></thead>
          <tbody>
            <tr v-for="b in view.bpmn" :key="b.id">
              <td><button class="link" @click="focusElement(b.kind === 'branch' ? b.id.slice(b.id.lastIndexOf('/') + 1) : b.id)">{{ b.id }}</button><div class="muted small">{{ b.label }}</div></td>
              <td class="small">{{ { session: 'session', email: 'e-mail', branch: 'branche' }[b.kind] }}</td>
              <td><StatusChip :status="b.status" /></td>
              <td class="small"><span v-if="b.links.length">{{ b.links.length > 3 ? `${b.links.length} états` : b.links.join(', ') }}</span> <span v-if="b.reason" class="muted">{{ b.reason }}</span></td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <JourneyVersions v-else-if="props.sub === 'versions'" :journey="props.journey" />
    <NewTest v-else-if="props.sub === 'new-test'" :journey="props.journey" />
    <Onboarding v-else-if="props.sub === 'onboarding'" :journey="props.journey" />
    <Assertions v-else-if="props.sub === 'assertions'" :journey="props.journey" />

    <Tracking
      v-else-if="props.sub === 'tracking' && st?.views.ui"
      :journey="props.journey"
      :ui="st.views.ui"
      :aside="st?.decisions?.aside ?? {}"
      :validations="st?.decisions?.smoke ?? {}"
    />

    <section v-else class="card placeholder">
      <h3>{{ SUBS.find((s) => s.id === props.sub)?.label }}</h3>
      <p class="muted">Arrive au jalon {{ SUBS.find((s) => s.id === props.sub)?.milestone }}.</p>
    </section>

    <Viewer v-if="viewer" :items="viewer.items" :start="viewer.start" @close="viewer = null" />
  </section>
</template>

<style scoped>
.space { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.switcher select { background: var(--panel); color: var(--text); border: 1px solid var(--rule); border-radius: 6px; padding: 6px 10px; font: inherit; font-family: var(--font-title); font-size: 18px; font-weight: 600; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.seg { display: inline-flex; border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; }
.seg button { background: none; border: 0; padding: 5px 10px; color: var(--muted); cursor: pointer; font-size: 13px; }
.seg button.on { background: var(--rule); color: var(--text); }
.cache { flex: 1; }
.updating { color: var(--traversed); }
.small { font-size: 12px; }
.subs { display: flex; gap: 2px; border-bottom: 1px solid var(--rule); flex-wrap: wrap; }
.subs button { background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px; color: var(--muted); cursor: pointer; }
.subs button.on { color: var(--text); border-bottom-color: var(--accent); }
.ms { font-size: 10px; margin-left: 4px; color: var(--muted); opacity: 0.7; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.grey, .notice { border-left: 3px solid var(--grey); }
.grey-list { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.session header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.counts { margin-left: auto; color: var(--text-2); }
.states { table-layout: fixed; }
.c-state { width: 34%; }
.c-tests { width: 70px; }
.c-cap { width: 90px; }
.row td { vertical-align: middle; }
.plain { color: var(--text); text-decoration: none; font-weight: 500; }
.caret { display: inline-block; width: 14px; color: var(--muted); }
.tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border: 1px solid var(--rule); border-radius: 3px; padding: 0 4px; margin-left: 6px; }
.tag.warn { color: var(--traversed); }
.thumb-btn { background: none; border: 0; padding: 0; cursor: zoom-in; display: block; }
.mini { height: 44px; border-radius: 3px; border: 1px solid var(--rule); display: block; }
.detail td { background: var(--panel-2); }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; padding: 6px 0; }
.dl-head { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.tests { list-style: none; margin: 0 0 8px; padding: 0; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
.cap { font-size: 10px; text-transform: uppercase; color: var(--covered); margin-left: 6px; letter-spacing: 0.05em; }
.visual { max-width: 180px; }
.big { width: 180px; border-radius: 6px; border: 1px solid var(--rule); }
.masked { aspect-ratio: 390 / 720; display: grid; place-items: center; text-align: center; padding: 8px; border: 1px dashed var(--rule); border-radius: 8px; color: var(--muted); font-size: 11px; }
.grid.two { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; }
@media (max-width: 1100px) { .grid.two, .kpis { grid-template-columns: minmax(0, 1fr); } }
.filters { display: flex; gap: 14px; align-items: center; }
.filters select { background: var(--panel); color: var(--text); border: 1px solid var(--rule); border-radius: 6px; padding: 4px 8px; margin-left: 6px; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.tile { margin: 0; }
.tile img { width: 100%; border-radius: 8px; border: 1px solid var(--rule); display: block; }
.cap-title { font-size: 12px; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cap-meta { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); }
.placeholder h3 { margin-bottom: 6px; }
.mode { align-self: flex-start; }
.mode-row { display: flex; justify-content: space-between; align-items: center; }
</style>
