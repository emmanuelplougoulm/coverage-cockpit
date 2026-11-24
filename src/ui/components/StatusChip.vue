<script setup lang="ts">
import type { CellStatus } from '../../core/fixture';

/** Statut : forme + libellé, jamais la couleur seule. */
const props = defineProps<{ status: CellStatus; compact?: boolean }>();
const META: Record<CellStatus, { shape: string; label: string }> = {
  covered: { shape: '●', label: 'capturé' },
  traversed: { shape: '◐', label: 'traversé' },
  missing: { shape: '○', label: 'manquant' },
  excluded: { shape: '⊘', label: 'exclu' },
  unlinked: { shape: '?', label: 'sans lien' },
};
</script>

<template>
  <span class="chip" :class="props.status" :title="META[props.status].label">
    <span class="shape" aria-hidden="true">{{ META[props.status].shape }}</span>
    <span :class="{ 'sr-only': props.compact }">{{ META[props.status].label }}</span>
  </span>
</template>

<style scoped>
.chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-2); white-space: nowrap; }
.shape { font-size: 13px; line-height: 1; }
.covered .shape { color: var(--covered); }
.traversed .shape { color: var(--traversed); }
.missing .shape { color: var(--missing); }
.excluded .shape, .unlinked .shape { color: var(--grey); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
