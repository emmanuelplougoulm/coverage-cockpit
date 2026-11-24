<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * Visionneuse zoomable : molette ou boutons pour le zoom, glisser pour se
 * déplacer, ← → pour naviguer, Échap pour fermer.
 */
export interface ViewerItem {
  title: string;
  subtitle: string;
  load: () => Promise<string>;
  open?: () => void;
}
const props = defineProps<{ items: ViewerItem[]; start: number }>();
const emit = defineEmits<{ close: [] }>();

const index = ref(props.start);
const src = ref<string | null>(null);
const error = ref<string | null>(null);
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
const item = computed(() => props.items[index.value]);
let drag: { x: number; y: number; px: number; py: number } | null = null;

async function load() {
  src.value = null;
  error.value = null;
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
  try {
    src.value = (await item.value?.load()) ?? null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}
watch(index, load, { immediate: true });

const setZoom = (z: number) => (zoom.value = Math.min(8, Math.max(0.5, z)));
const go = (d: number) => (index.value = (index.value + d + props.items.length) % props.items.length);
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
  else if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === '+' || e.key === '=') setZoom(zoom.value * 1.25);
  else if (e.key === '-') setZoom(zoom.value / 1.25);
  else if (e.key === '0') setZoom(1);
}
function onWheel(e: WheelEvent) {
  e.preventDefault();
  setZoom(zoom.value * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}
function onDown(e: PointerEvent) {
  drag = { x: e.clientX, y: e.clientY, px: pan.value.x, py: pan.value.y };
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
}
function onMove(e: PointerEvent) {
  if (drag) pan.value = { x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y };
}
const onUp = () => (drag = null);
const closeBtn = ref<HTMLButtonElement | null>(null);
onMounted(() => {
  window.addEventListener('keydown', onKey);
  closeBtn.value?.focus();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" :aria-label="item?.title" @click.self="emit('close')">
    <header>
      <div>
        <div class="title">{{ item?.title }}</div>
        <div class="sub">{{ item?.subtitle }} · {{ index + 1 }}/{{ props.items.length }}</div>
      </div>
      <div class="tools">
        <button class="ghost" aria-label="Précédente" @click="go(-1)">←</button>
        <button class="ghost" aria-label="Suivante" @click="go(1)">→</button>
        <button class="ghost" aria-label="Dézoomer" @click="setZoom(zoom / 1.25)">−</button>
        <span class="num zoom">{{ Math.round(zoom * 100) }} %</span>
        <button class="ghost" aria-label="Zoomer" @click="setZoom(zoom * 1.25)">+</button>
        <button class="ghost" @click="setZoom(1)">1:1</button>
        <button v-if="item?.open" class="ghost" @click="item.open()">Ouvrir dans Aperçu</button>
        <button ref="closeBtn" class="ghost" aria-label="Fermer" @click="emit('close')">✕</button>
      </div>
    </header>
    <div class="stage" @wheel="onWheel" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="!src" class="muted">Chargement…</p>
      <img v-else :src="src" :alt="item?.title" draggable="false" :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }" />
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 40; background: rgb(8 10 14 / 0.92); display: flex; flex-direction: column; }
header { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid var(--rule); gap: 16px; }
.title { font-weight: 600; }
.sub { font-size: 12px; color: var(--muted); }
.tools { display: flex; gap: 6px; align-items: center; }
.zoom { min-width: 52px; text-align: center; font-size: 12px; }
.stage { flex: 1; overflow: hidden; display: grid; place-items: center; cursor: grab; touch-action: none; }
.stage:active { cursor: grabbing; }
img { max-height: calc(100vh - 110px); max-width: 90vw; transform-origin: center; user-select: none; box-shadow: 0 8px 40px rgb(0 0 0 / 0.5); }
</style>
