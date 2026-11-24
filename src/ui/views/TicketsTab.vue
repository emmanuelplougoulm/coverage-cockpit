<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { HINT_LABEL, type Ticket } from '../../core/tickets';
import RunThread from '../components/RunThread.vue';
import { loadTickets, runAgent, runsStore, setCampaignTicket, store, ticketsStore } from '../store';

/** « Mes tickets » (§15) : par sprint, parcours déduit + indices divergents, lecture seule. */
const emit = defineEmits<{ open: [journey: string, sub?: string] }>();
const sdkRuns = reactive<Record<string, string>>({});
/** « Analyser » : préremplit « Nouveau test » (suite UI, pas de scission). */
function analyse(t: Ticket) {
  runsStore.draftRequest[t.journey!] = `Ticket ${t.key} — ${t.summary}\n\n${t.description}`;
  emit('open', t.journey!, 'new-test');
}
async function analyseSdk(t: Ticket) {
  error.value = null;
  try {
    sdkRuns[t.key] = (await runAgent(['sdk-analyse', t.key])).id;
    open.add(t.key);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
onMounted(() => {
  if (!ticketsStore.data) void loadTickets();
});

const label = (id: string) => store.journeys?.journeys.find((j) => j.id === id)?.label ?? id;
const groups = computed(() => {
  const tickets = ticketsStore.data?.tickets ?? [];
  const key = (t: Ticket) => t.sprints.find((s) => s.state === 'ACTIVE') ?? t.sprints.find((s) => s.state === 'FUTURE') ?? null;
  const map = new Map<string, { title: string; state: string; tickets: Ticket[] }>();
  for (const t of tickets) {
    const s = key(t);
    const k = s ? `${s.state}|${s.name}` : 'NONE|';
    const g = map.get(k) ?? { title: s ? s.name : 'Sans sprint ouvert', state: s?.state ?? 'NONE', tickets: [] };
    g.tickets.push(t);
    map.set(k, g);
  }
  const rank = (st: string) => (st === 'ACTIVE' ? 0 : st === 'FUTURE' ? 1 : 2);
  return [...map.values()].sort((a, b) => rank(a.state) - rank(b.state) || a.title.localeCompare(b.title));
});
const open = reactive(new Set<string>());
const toggle = (k: string) => (open.has(k) ? open.delete(k) : open.add(k));
const busy = ref(false);
const error = ref<string | null>(null);
async function campaign(journey: string, key: string | null) {
  busy.value = true;
  error.value = null;
  try {
    await setCampaignTicket(journey, key);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
const CAT: Record<string, { shape: string; label: string; cls: string }> = {
  new: { shape: '○', label: 'à faire', cls: 'new' },
  indeterminate: { shape: '◐', label: 'en cours', cls: 'doing' },
};
</script>

<template>
  <section class="tickets">
    <div class="head">
      <h2>Mes tickets</h2>
      <span class="muted small">
        <template v-if="ticketsStore.data?.source === 'fake'">faux Jira du corpus (réponses anonymisées)</template>
        <template v-else-if="ticketsStore.data?.source === 'jira'">Jira · lecture seule</template>
        · tickets assignés, non terminés (100 au plus)
      </span>
      <button class="ghost" :disabled="ticketsStore.loading" @click="loadTickets">{{ ticketsStore.loading ? 'Lecture…' : 'Relire' }}</button>
    </div>
    <p v-if="ticketsStore.error || ticketsStore.data?.error || error" class="error" role="alert">{{ ticketsStore.error ?? ticketsStore.data?.error ?? error }}</p>

    <section v-if="ticketsStore.data && !ticketsStore.data.configured" class="card">
      <h3>Jira n'est pas configuré</h3>
      <p class="muted">Définir <code>CC_JIRA_URL</code> et ranger le jeton d'accès personnel dans le trousseau macOS (service <code>coverage-cockpit-jira</code>, ou <code>CC_JIRA_KEYCHAIN_SERVICE</code>). Champs personnalisés : <code>CC_JIRA_FIELD_BPMN</code>, <code>_TAXONOMY</code>, <code>_EPIC</code>, <code>_SPRINT</code>. Le jeton n'est jamais affiché ni journalisé.</p>
    </section>

    <section v-for="g in groups" :key="g.state + g.title" class="card">
      <h3>{{ g.title }} <span class="muted small">{{ { ACTIVE: 'sprint actif', FUTURE: 'sprint à venir', NONE: '' }[g.state] ?? '' }}</span></h3>
      <table class="data">
        <colgroup><col style="width: 110px" /><col /><col style="width: 100px" /><col style="width: 110px" /><col style="width: 260px" /><col style="width: 210px" /></colgroup>
        <thead><tr><th>Ticket</th><th>Résumé</th><th>Type</th><th>État</th><th>Parcours</th><th /></tr></thead>
        <tbody>
          <template v-for="t in g.tickets" :key="t.key">
            <tr>
              <td><button class="link mono" :aria-expanded="open.has(t.key)" @click="toggle(t.key)">{{ t.key }}</button></td>
              <td>{{ t.summary }}</td>
              <td class="small">{{ t.type }}</td>
              <td class="small"><span class="cat" :class="CAT[t.statusCategory]?.cls">{{ CAT[t.statusCategory]?.shape ?? '·' }}</span> {{ t.status }}</td>
              <td class="small">
                <template v-if="t.journey">
                  <button class="link" @click="emit('open', t.journey)">{{ label(t.journey) }}</button>
                  <div class="muted">par {{ HINT_LABEL[t.decidedBy!] }}</div>
                  <div v-if="t.divergent" class="warn">indices divergents</div>
                </template>
                <span v-else class="muted">aucun parcours déduit</span>
              </td>
              <td class="small actions">
                <template v-if="t.journey">
                  <span v-if="ticketsStore.data?.campaign[t.journey] === t.key" class="ok">ticket de campagne</span>
                  <button v-else class="ghost xs" :disabled="busy" title="1 ticket par parcours = 1 branche du dépôt de tests" @click="campaign(t.journey, t.key)">Ticket de campagne</button>
                </template>
                <button v-if="t.journey" class="ghost xs" title="Préremplit « Nouveau test » avec ce ticket" @click="analyse(t)">Analyser</button>
                <button v-else class="ghost xs" title="L'IA lit le ticket et tous les fronts configurés (lecture seule)" @click="analyseSdk(t)">Analyser (SDK)</button>
              </td>
            </tr>
            <tr v-if="open.has(t.key)" class="detail">
              <td colspan="6">
                <p class="desc">{{ t.description || '(pas de description)' }}</p>
                <ul class="hints small">
                  <li v-for="h in t.hints" :key="h.kind">
                    <strong>{{ HINT_LABEL[h.kind] }}</strong> « {{ h.evidence }} » →
                    <template v-if="h.journeys.length">{{ h.journeys.map(label).join(', ') }}</template>
                    <span v-else class="muted">aucun parcours configuré</span>
                  </li>
                  <li v-if="sdkRuns[t.key]" class="sdk"><RunThread v-if="runsStore.byId[sdkRuns[t.key]!]" :run-id="sdkRuns[t.key]!" reply-cmd="ask-reply" stop-cmd="run-stop" /></li>
                  <li v-if="!t.hints.length" class="muted">Aucun indice : ni champ BPMN, ni clé de cas, ni nom de processus, ni crochets, ni taxonomie, ni epic connue.</li>
                </ul>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>
  </section>
</template>

<style scoped>
.tickets { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: baseline; gap: 16px; }
.head .muted { flex: 1; }
.small { font-size: 12px; }
.mono { font-family: var(--font-mono); }
table.data { table-layout: fixed; }
.cat.new { color: var(--missing); }
.cat.doing { color: var(--traversed); }
.warn { color: var(--traversed); }
.ok { color: var(--text-2); }
.actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.xs { font-size: 12px; padding: 2px 8px; }
.detail td { background: var(--panel-2); }
.desc { white-space: pre-wrap; margin: 0 0 8px; color: var(--text-2); }
.sdk { list-style: none; margin: 8px 0 0 -18px; }
.hints { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
</style>
