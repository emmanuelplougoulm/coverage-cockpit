<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { indicators } from '../../core/indicators';
import { dateFr, pct } from '../components/chart';
import { loadVersions, markSeen, store, versionsStore } from '../store';

/** Onglet « Versions BPMN » (§15) : par parcours, rafraîchir (fetch), marquer vu. */
const emit = defineEmits<{ open: [journey: string] }>();
onMounted(() => {
  if (!versionsStore.data) void loadVersions(false);
});

const label = (id: string) => store.journeys?.journeys.find((j) => j.id === id)?.label ?? id;
const fetchResult = computed(() => versionsStore.data?.fetch);
/** Parcours sans test : listés à 0 %. */
const untested = computed(() =>
  (store.journeys?.journeys ?? []).filter((j) => {
    const v = store.byJourney[j.id]?.views.ui;
    return !v || v.testsScanned === 0 || (indicators(v).coverage ?? 0) === 0;
  }),
);
</script>

<template>
  <section class="versions">
    <div class="head">
      <h2>Versions BPMN</h2>
      <span class="muted small">
        <template v-if="versionsStore.loading">lecture…</template>
        <template v-else-if="fetchResult?.attempted && !fetchResult.ok">fetch impossible : {{ fetchResult.error }} — affichage du local</template>
        <template v-else-if="fetchResult?.updated">dépôt workflow mis à jour (avance rapide)</template>
        <template v-else-if="fetchResult?.skipped">fetch fait, clone non avancé : {{ fetchResult.skipped }}</template>
        <template v-else-if="fetchResult?.attempted">fetch fait, déjà à jour</template>
      </span>
      <button class="ghost" :disabled="versionsStore.loading" title="git fetch, puis avance rapide seulement si le clone est propre, sur sa branche principale, sans commit local" @click="loadVersions(true)">Rafraîchir</button>
    </div>
    <p v-if="versionsStore.error" class="error" role="alert">{{ versionsStore.error }}</p>

    <section v-for="j in versionsStore.data?.journeys ?? []" :key="j.journey" class="card">
      <header>
        <h3><button class="link title" @click="emit('open', j.journey)">{{ label(j.journey) }}</button></h3>
        <span class="num">local {{ j.localVersion ?? '—' }}</span>
        <span v-if="j.latest && j.latest !== j.localVersion" class="tag warn">{{ j.latest }} publiée, pas encore récupérée</span>
        <span v-if="j.newSinceSeen.length" class="tag new">{{ j.newSinceSeen.length }} nouvelle{{ j.newSinceSeen.length > 1 ? 's' : '' }} version{{ j.newSinceSeen.length > 1 ? 's' : '' }}</span>
        <span class="spacer" />
        <span class="muted small">vue : {{ j.seen ?? 'jamais' }}</span>
        <button v-if="j.latest && j.seen !== j.latest" class="ghost small" @click="markSeen(j.journey, j.latest!)">Marquer {{ j.latest }} comme vue</button>
      </header>
      <p v-if="j.error" class="muted">{{ j.error }}</p>
      <p v-else class="muted small">
        Clone sur <code>{{ j.repo.branch ?? 'HEAD détachée' }}</code> · {{ j.repo.clean ? 'propre' : 'modifications locales' }}
        <template v-if="j.repo.ahead"> · {{ j.repo.ahead }} commit(s) local(aux)</template>
        <template v-if="j.repo.behind"> · {{ j.repo.behind }} commit(s) à récupérer</template>
      </p>

      <ol v-if="j.versions.length" class="timeline">
        <li v-for="v in [...j.versions].reverse()" :key="v.version" :class="{ remote: v.remoteOnly, unseen: j.newSinceSeen.includes(v.version) }">
          <div class="v-head">
            <strong class="num">{{ v.version }}</strong>
            <span class="muted small num">{{ dateFr(v.date, true) }}</span>
            <span v-if="v.remoteOnly" class="tag warn">distante</span>
            <span v-if="j.newSinceSeen.includes(v.version)" class="tag new">non vue</span>
            <span v-for="t in v.tickets" :key="t" class="ticket num">{{ t }}</span>
          </div>
          <ul class="commits small">
            <li v-for="c in v.commits" :key="c.hash"><code class="muted">{{ c.hash.slice(0, 7) }}</code> {{ c.subject }}</li>
          </ul>
        </li>
      </ol>

      <div v-if="j.unpublished.length" class="block">
        <h4>Commits non publiés <span class="muted">(après {{ j.versions.at(-1)?.version }})</span></h4>
        <ul class="commits small"><li v-for="c in j.unpublished" :key="c.hash"><code class="muted">{{ c.hash.slice(0, 7) }}</code> {{ c.subject }}</li></ul>
      </div>
      <div v-if="j.branches.length" class="block">
        <h4>Branches distantes non fusionnées qui touchent ce BPMN</h4>
        <ul class="commits small">
          <li v-for="b in j.branches" :key="b.branch"><code>{{ b.branch }}</code> — {{ b.commits.length }} commit{{ b.commits.length > 1 ? 's' : '' }} <span v-for="t in b.tickets" :key="t" class="ticket num">{{ t }}</span></li>
        </ul>
      </div>
      <button class="link small" @click="emit('open', j.journey)">Diff et tests impactés →</button>
    </section>

    <section class="card">
      <h3>Parcours non testés</h3>
      <p v-if="!untested.length" class="muted">Tous les parcours ont au moins un test.</p>
      <ul v-else><li v-for="j in untested" :key="j.id">{{ j.label }} — <span class="num">{{ pct(0) }}</span></li></ul>
    </section>
  </section>
</template>

<style scoped>
.versions { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: baseline; gap: 16px; }
.head .muted { flex: 1; }
.small { font-size: 12px; }
header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.title { color: var(--text); text-decoration: none; font: inherit; font-family: var(--font-title); font-size: 16px; font-weight: 600; }
.spacer { flex: 1; }
.tag { font-size: 11px; border: 1px solid currentColor; border-radius: 3px; padding: 0 5px; }
.tag.new { color: var(--accent); }
.tag.warn { color: var(--traversed); }
.ticket { font-size: 11px; background: var(--panel-2); border: 1px solid var(--rule); border-radius: 3px; padding: 0 4px; color: var(--text-2); }
.timeline { list-style: none; margin: 12px 0 0; padding: 0 0 0 14px; border-left: 2px solid var(--rule); display: flex; flex-direction: column; gap: 10px; }
.timeline > li { position: relative; }
.timeline > li::before { content: ''; position: absolute; left: -20px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: var(--panel); border: 2px solid var(--muted); }
.timeline > li.unseen::before { border-color: var(--accent); }
.timeline > li.remote { opacity: 0.85; }
.v-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.commits { list-style: none; margin: 4px 0 0; padding: 0; color: var(--text-2); display: flex; flex-direction: column; gap: 2px; }
.block { margin-top: 12px; }
h4 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
</style>
