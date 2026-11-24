<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

/** Chiffre-clé animé (§15 : compteurs animés), sans animation si mouvement réduit. */
const props = defineProps<{ label: string; value: number | null; format?: 'pct' | 'int'; hint?: string; detail?: string; stale?: boolean }>();
const shown = ref(0);
let raf = 0;

const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(to: number) {
  cancelAnimationFrame(raf);
  const from = shown.value;
  if (reduce() || from === to) {
    shown.value = to;
    return;
  }
  const start = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - start) / 600);
    shown.value = from + (to - from) * (1 - (1 - k) ** 3);
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
watch(() => props.value, (v) => animate(v ?? 0), { immediate: true });
onBeforeUnmount(() => cancelAnimationFrame(raf));

const text = (v: number) => (props.format === 'pct' ? `${Math.round(v * 100)} %` : String(Math.round(v)));
</script>

<template>
  <div class="kpi" :class="{ stale: props.stale }" :title="props.hint">
    <div class="label">{{ props.label }}</div>
    <div class="value num">{{ props.value === null ? '—' : text(shown) }}</div>
    <div v-if="props.detail" class="detail">{{ props.detail }}</div>
  </div>
</template>

<style scoped>
.kpi { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 16px; min-width: 0; }
.label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.value { font-size: 30px; font-weight: 600; margin-top: 4px; }
.detail { font-size: 12px; color: var(--text-2); margin-top: 2px; }
</style>
