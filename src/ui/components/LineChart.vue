<script setup lang="ts">
import { computed, ref } from 'vue';
import { dateFr, linear, pct } from './chart';
import { hideTip, showTip } from './tooltip';

/**
 * Courbes en pourcentage (0–100 %) sur un axe x commun : dates ou rangs.
 * Survol : réticule + infobulle de toutes les séries au point le plus proche.
 */
export interface Series {
  name: string;
  color: string;
  points: { x: number; y: number | null }[];
}
const props = withDefaults(defineProps<{ series: Series[]; xKind: 'date' | 'int'; xLabel?: string; step?: boolean; width?: number }>(), { width: 560 });
const W = props.width;
const H = Math.round(props.width * 0.42);
const M = { l: 42, r: props.width < 450 ? 54 : 96, t: 12, b: 30 };

const xs = computed(() => [...new Set(props.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b));
const x = computed(() => linear(xs.value[0] ?? 0, xs.value.at(-1) ?? 1, M.l + 6, W - M.r));
const y = linear(0, 1, H - M.b, M.t);
const fmtX = (v: number) => (props.xKind === 'date' ? dateFr(new Date(v).toISOString()) : String(v));

function path(s: Series): string {
  const pts = s.points.filter((p) => p.y !== null);
  return pts
    .map((p, i) => {
      const px = x.value(p.x);
      const py = y(p.y!);
      if (i === 0) return `M${px},${py}`;
      return props.step ? `H${px}V${py}` : `L${px},${py}`;
    })
    .join('');
}
const last = (s: Series) => [...s.points].reverse().find((p) => p.y !== null);

const hover = ref<number | null>(null);
function onMove(e: MouseEvent) {
  const svg = e.currentTarget as SVGSVGElement;
  const box = svg.getBoundingClientRect();
  const px = ((e.clientX - box.left) / box.width) * W;
  let best = xs.value[0];
  for (const v of xs.value) if (Math.abs(x.value(v) - px) < Math.abs(x.value(best!) - px)) best = v;
  if (best === undefined) return;
  hover.value = best;
  showTip(e, [
    props.xKind === 'date' ? dateFr(new Date(best).toISOString(), true) : `${props.xLabel ?? ''} ${best}`.trim(),
    ...props.series.map((s) => `${s.name} : ${pct(s.points.find((p) => p.x === best)?.y)}`),
  ]);
}
function onLeave() {
  hover.value = null;
  hideTip();
}
</script>

<template>
  <div>
    <div v-if="props.series.length > 1" class="legend">
      <span v-for="s in props.series" :key="s.name"><i :style="{ background: s.color }" />{{ s.name }}</span>
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="props.series.map((s) => `${s.name} : ${pct(last(s)?.y)}`).join(', ')" @mousemove="onMove" @mouseleave="onLeave">
      <g v-for="t in [0, 0.25, 0.5, 0.75, 1]" :key="t">
        <line :x1="M.l" :x2="W - M.r" :y1="y(t)" :y2="y(t)" class="grid" />
        <text :x="M.l - 6" :y="y(t) + 4" class="axis num" text-anchor="end">{{ t * 100 }} %</text>
      </g>
      <template v-if="xs.length">
        <text :x="x(xs[0]!)" :y="H - 8" class="axis num" text-anchor="start">{{ fmtX(xs[0]!) }}</text>
        <text v-if="xs.length > 1" :x="x(xs.at(-1)!)" :y="H - 8" class="axis num" text-anchor="end">{{ fmtX(xs.at(-1)!) }}</text>
      </template>
      <line v-if="hover !== null" :x1="x(hover)" :x2="x(hover)" :y1="M.t" :y2="H - M.b" class="cross" />
      <g v-for="s in props.series" :key="s.name">
        <path :d="path(s)" fill="none" :stroke="s.color" stroke-width="2" stroke-linejoin="round" />
        <circle v-for="p in s.points.filter((q) => q.y !== null)" :key="p.x" :cx="x(p.x)" :cy="y(p.y!)" r="4" :fill="s.color" stroke="var(--panel)" stroke-width="2" />
        <text v-if="last(s)" :x="x(last(s)!.x) + 8" :y="y(last(s)!.y!) + 4" class="end num">{{ pct(last(s)!.y) }}<tspan v-if="props.series.length > 1" class="axis" dx="5">{{ s.name }}</tspan></text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
svg { width: 100%; height: auto; display: block; }
.grid { stroke: var(--grid); }
.cross { stroke: var(--muted); stroke-dasharray: 3 3; }
.axis { fill: var(--muted); font-size: 11px; }
.end { fill: var(--text); font-size: 12px; }
.legend { display: flex; gap: 14px; font-size: 12px; color: var(--text-2); margin-bottom: 4px; }
.legend i { display: inline-block; width: 14px; height: 2px; margin-right: 6px; vertical-align: 3px; }
</style>
