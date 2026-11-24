<script setup lang="ts">
import { computed } from 'vue';
import { hBar, pct } from './chart';
import { hideTip, showTip } from './tooltip';

/** Entonnoir de couverture : cellules → atteintes → capturées (rampe ordinale, une teinte). */
const props = defineProps<{ stages: { label: string; value: number; hint: string }[] }>();
const W = 560;
const ROW = 40;
const LABEL = 150;
const total = computed(() => props.stages[0]?.value ?? 0);
const x = (v: number) => LABEL + (total.value ? (v / total.value) * (W - LABEL - 90) : 0);
const fills = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)'];
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${props.stages.length * ROW}`" role="img" :aria-label="props.stages.map((s) => `${s.label} ${s.value}`).join(', ')">
    <g v-for="(s, i) in props.stages" :key="s.label">
      <text :x="0" :y="i * ROW + 24" class="label">{{ s.label }}</text>
      <path
        :d="hBar(LABEL, i * ROW + 8, Math.max(x(s.value), LABEL + 2), 24)"
        :fill="fills[i] ?? 'var(--seq-3)'"
        tabindex="0"
        @mousemove="showTip($event, [s.label, `${s.value} cellules (${pct(total ? s.value / total : null)})`, s.hint])"
        @focus="showTip($event, [s.label, `${s.value} cellules`, s.hint])"
        @mouseleave="hideTip"
        @blur="hideTip"
      />
      <text :x="x(s.value) + 8" :y="i * ROW + 25" class="value num">{{ s.value }} · {{ pct(total ? s.value / total : null) }}</text>
    </g>
  </svg>
</template>

<style scoped>
svg { width: 100%; height: auto; display: block; }
.label { fill: var(--text-2); font-size: 13px; }
.value { fill: var(--text); font-size: 12px; }
path:focus { outline: none; stroke: var(--text); stroke-width: 1.5; }
</style>
