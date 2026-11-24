<script setup lang="ts">
import { ref } from 'vue';

/** Demande « Nouveau test » rédigée : copiée pour l'instant, lancée par l'IA au jalon 9. */
const props = defineProps<{ text: string }>();
const emit = defineEmits<{ close: []; use: [] }>();
const copied = ref(false);
async function copy() {
  await navigator.clipboard.writeText(props.text);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="panel">
    <pre>{{ props.text }}</pre>
    <div class="actions">
      <button class="primary" @click="emit('use')">Ouvrir dans « Nouveau test »</button>
      <button class="ghost" @click="copy">{{ copied ? 'Copiée' : 'Copier la demande' }}</button>
      <button class="ghost" @click="emit('close')">Fermer</button>
    </div>
  </div>
</template>

<style scoped>
.panel { background: var(--ink); border: 1px solid var(--rule); border-radius: 6px; padding: 10px 12px; margin-top: 8px; }
pre { margin: 0 0 8px; white-space: pre-wrap; font-family: var(--font-mono); font-size: 12px; color: var(--text-2); }
.actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
.primary { background: var(--accent); color: #0b1220; border: 0; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-weight: 600; margin-right: auto; }
</style>
