<script setup lang="ts">
import type { ScenarioState } from '../../core/families';

/** État d'un scénario : forme + libellé. */
const props = defineProps<{ state: ScenarioState }>();
const META: Record<ScenarioState, { shape: string; label: string }> = {
  done: { shape: '●', label: 'fait' },
  partial: { shape: '◐', label: 'partiel' },
  todo: { shape: '○', label: 'à faire' },
  aside: { shape: '⊘', label: 'écarté' },
};
</script>

<template>
  <span class="chip" :class="props.state"><span class="shape" aria-hidden="true">{{ META[props.state].shape }}</span>{{ META[props.state].label }}</span>
</template>

<style scoped>
.chip { display: inline-flex; gap: 5px; align-items: center; font-size: 12px; color: var(--text-2); white-space: nowrap; }
.done .shape { color: var(--covered); }
.partial .shape { color: var(--traversed); }
.todo .shape { color: var(--missing); }
.aside .shape { color: var(--grey); }
</style>
