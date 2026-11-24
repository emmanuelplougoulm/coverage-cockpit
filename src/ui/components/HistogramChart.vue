<script setup lang="ts">
import { computed } from 'vue';
import { linear, ticks, vBar } from './chart';
import { hideTip, showTip } from './tooltip';

/** Histogramme : nombre de tests qui atteignent chaque cellule d'écran. */
const props = defineProps<{ buckets: { bucket: string; count: number }[] }>();
const W = 360;
const H = 200;
const M = { l: 34, r: 8, t: 10, b: 28 };
const max = computed(() => Math.max(1, ...props.buckets.map((b) => b.count)));
const yTicks = computed(() => ticks(max.value, 4));
const y = computed(() => linear(0, yTicks.value.at(-1)!, H - M.b, M.t));
const band = computed(() => (W - M.l - M.r) / Math.max(1, props.buckets.length));
const bw = computed(() => Math.min(44, band.value - 2));
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="props.buckets.map((b) => `${b.bucket} test(s) : ${b.count}`).join(', ')">
    <g v-for="t in yTicks" :key="t">
      <line :x1="M.l" :x2="W - M.r" :y1="y(t)" :y2="y(t)" class="grid" />
      <text :x="M.l - 6" :y="y(t) + 4" class="axis num" text-anchor="end">{{ t }}</text>
    </g>
    <g v-for="(b, i) in props.buckets" :key="b.bucket">
      <path
        :d="vBar(M.l + i * band + (band - bw) / 2, y(b.count), bw, H - M.b)"
        fill="var(--series-1)"
        tabindex="0"
        @mousemove="showTip($event, [`${b.bucket} test${b.bucket === '1' ? '' : 's'}`, `${b.count} cellule${b.count > 1 ? 's' : ''}`])"
        @focus="showTip($event, [`${b.bucket} tests`, `${b.count} cellules`])"
        @mouseleave="hideTip"
        @blur="hideTip"
      />
      <rect :x="M.l + i * band" :y="M.t" :width="band" :height="H - M.t - M.b" fill="transparent"
        @mousemove="showTip($event, [`${b.bucket} test${b.bucket === '1' ? '' : 's'}`, `${b.count} cellule${b.count > 1 ? 's' : ''}`])" @mouseleave="hideTip" />
      <text :x="M.l + i * band + band / 2" :y="H - 8" class="axis num" text-anchor="middle">{{ b.bucket }}</text>
    </g>
    <line :x1="M.l" :x2="W - M.r" :y1="H - M.b" :y2="H - M.b" class="base" />
  </svg>
</template>

<style scoped>
svg { width: 100%; height: auto; display: block; }
.grid { stroke: var(--grid); stroke-width: 1; }
.base { stroke: var(--muted); stroke-width: 1; }
.axis { fill: var(--muted); font-size: 11px; }
path:focus { outline: none; stroke: var(--text); stroke-width: 1.5; }
</style>
