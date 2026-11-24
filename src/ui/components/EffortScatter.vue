<script setup lang="ts">
import { computed } from 'vue';
import type { StateEffort } from '../../core/indicators';
import { linear, ticks } from './chart';
import { hideTip, showTip } from './tooltip';

/**
 * Effort : tests qui atteignent une cellule (x) contre captures (y).
 * Les cellules au même point sont regroupées : l'aire dit combien.
 */
const props = defineProps<{ cells: StateEffort[] }>();
const W = 360;
const H = 220;
const M = { l: 40, r: 16, t: 22, b: 34 };

const groups = computed(() => {
  const m = new Map<string, { tests: number; captures: number; isError: boolean; refs: string[] }>();
  for (const c of props.cells) {
    const k = `${c.tests}|${c.captures}|${c.isError}`;
    const g = m.get(k) ?? { tests: c.tests, captures: c.captures, isError: c.isError, refs: [] };
    g.refs.push(`${c.ref} (${c.locale})`);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.refs.length - a.refs.length);
});
const xTicks = computed(() => ticks(Math.max(2, ...props.cells.map((c) => c.tests)), 4, true));
const yTicks = computed(() => ticks(Math.max(1, ...props.cells.map((c) => c.captures)), 3, true));
const x = computed(() => linear(0, xTicks.value.at(-1)!, M.l + 22, W - M.r - 12));
const y = computed(() => linear(0, yTicks.value.at(-1)!, H - M.b - 10, M.t + 6));
const r = (n: number) => 4 + Math.sqrt(n) * 2.6;
const lines = (g: (typeof groups.value)[number]) => [
  `${g.refs.length} cellule${g.refs.length > 1 ? 's' : ''} ${g.isError ? "d'erreur" : 'nominale' + (g.refs.length > 1 ? 's' : '')}`,
  `${g.tests} test${g.tests > 1 ? 's' : ''}, ${g.captures} capture${g.captures > 1 ? 's' : ''}`,
  ...g.refs.slice(0, 6),
  ...(g.refs.length > 6 ? [`… +${g.refs.length - 6}`] : []),
];
</script>

<template>
  <div>
    <div class="legend">
      <span><i class="dot" style="background: var(--series-1)" />Nominal</span>
      <span><i class="dot" style="background: var(--series-2)" />Erreur</span>
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Tests par cellule contre captures par cellule">
      <g v-for="t in yTicks" :key="'y' + t">
        <line :x1="M.l" :x2="W - M.r" :y1="y(t)" :y2="y(t)" class="grid" />
        <text :x="M.l - 6" :y="y(t) + 4" class="axis num" text-anchor="end">{{ t }}</text>
      </g>
      <text v-for="t in xTicks" :key="'x' + t" :x="x(t)" :y="H - M.b + 16" class="axis num" text-anchor="middle">{{ t }}</text>
      <text :x="(W + M.l) / 2" :y="H - 4" class="axis" text-anchor="middle">tests qui l'atteignent</text>
      <text :x="M.l - 6" :y="10" class="axis" text-anchor="end">captures</text>
      <circle
        v-for="g in groups"
        :key="`${g.tests}|${g.captures}|${g.isError}`"
        :cx="x(g.tests) + (g.isError ? 5 : -5)"
        :cy="y(g.captures)"
        :r="r(g.refs.length)"
        :fill="g.isError ? 'var(--series-2)' : 'var(--series-1)'"
        stroke="var(--panel)"
        stroke-width="2"
        tabindex="0"
        @mousemove="showTip($event, lines(g))"
        @focus="showTip($event, lines(g))"
        @mouseleave="hideTip"
        @blur="hideTip"
      />
    </svg>
  </div>
</template>

<style scoped>
svg { width: 100%; height: auto; display: block; }
.grid { stroke: var(--grid); }
.axis { fill: var(--muted); font-size: 11px; }
.legend { display: flex; gap: 14px; font-size: 12px; color: var(--text-2); margin-bottom: 4px; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
circle:focus { outline: none; stroke: var(--text); }
</style>
