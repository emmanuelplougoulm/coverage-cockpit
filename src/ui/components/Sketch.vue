<script setup lang="ts">
import { computed } from 'vue';

/**
 * Croquis d'un écran non capturé (§5.2 screenSketch) : ses textes du front,
 * mis en page comme un fil de fer. Ce n'est pas l'écran réel.
 */
const props = defineProps<{ texts: Record<string, string> | undefined; label: string }>();
const entries = computed(() => Object.entries(props.texts ?? {}));
const title = computed(() => props.texts?.title ?? props.texts?.text ?? null);
const rest = computed(() => entries.value.filter(([k]) => k !== 'title' && !(k === 'text' && !props.texts?.title)));
const isButton = (k: string) => /cta|button|submit|continue/i.test(k);
</script>

<template>
  <div class="sketch" :aria-label="`Croquis de ${props.label}`">
    <div class="bar" />
    <div v-if="title" class="title">{{ title }}</div>
    <div v-else class="none">Aucun texte dans cette langue</div>
    <template v-for="[k, v] in rest" :key="k">
      <div v-if="isButton(k)" class="button">{{ v }}</div>
      <div v-else class="field"><span class="k">{{ k }}</span>{{ v }}</div>
    </template>
    <div class="stamp">croquis</div>
  </div>
</template>

<style scoped>
.sketch { position: relative; aspect-ratio: 390 / 720; background: repeating-linear-gradient(135deg, var(--panel-2) 0 6px, var(--panel) 6px 12px); border: 1px dashed var(--rule); border-radius: 8px; padding: 0 10px 10px; overflow: hidden; font-size: 11px; color: var(--text-2); }
.bar { height: 18px; margin: 0 -10px 12px; background: var(--rule); }
.title { font-weight: 600; font-size: 12px; color: var(--text); margin-bottom: 10px; }
.none { color: var(--muted); font-style: italic; }
.field { border: 1px solid var(--rule); background: var(--ink); border-radius: 4px; padding: 4px 6px; margin-bottom: 6px; }
.k { display: block; font-size: 9px; color: var(--muted); }
.button { margin-top: 8px; text-align: center; border: 1px solid var(--accent); color: var(--accent); border-radius: 4px; padding: 4px; }
.stamp { position: absolute; right: 8px; bottom: 6px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
</style>
