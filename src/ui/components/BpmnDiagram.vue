<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CellStatus } from '../../core/fixture';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';

/**
 * Diagramme bpmn-js (lecture seule) coloré par statut. Si le BPMN n'a pas de
 * mise en page (DI), elle est générée par bpmn-auto-layout.
 */
const props = defineProps<{ xml: string; generated: boolean; statuses: Record<string, CellStatus>; focus?: string | null }>();
const host = ref<HTMLDivElement | null>(null);
const error = ref<string | null>(null);
type Viewer = { importXML(x: string): Promise<unknown>; get<T>(n: string): T; destroy(): void };
let viewer: Viewer | null = null;

async function render() {
  if (!host.value) return;
  error.value = null;
  try {
    const { default: NavigatedViewer } = await import('bpmn-js/lib/NavigatedViewer');
    const xml = props.xml;
    viewer?.destroy();
    viewer = new NavigatedViewer({ container: host.value }) as unknown as Viewer;
    await viewer.importXML(xml);
    const canvas = viewer.get<{ zoom(z: string): void; addMarker(id: string, m: string): void }>('canvas');
    const registry = viewer.get<{ get(id: string): unknown }>('elementRegistry');
    for (const [id, status] of Object.entries(props.statuses)) if (registry.get(id)) canvas.addMarker(id, `cc-${status}`);
    canvas.zoom('fit-viewport');
    focusOn(props.focus);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

/** Cadre la vue sur un élément (avec de la marge autour), lisible même dans un grand processus. */
function focusOn(id: string | null | undefined) {
  if (!viewer || !id) return;
  const el = viewer.get<{ get(id: string): unknown }>('elementRegistry').get(id) as
    | { x?: number; y?: number; width?: number; height?: number; waypoints?: { x: number; y: number }[] }
    | undefined;
  if (!el) return;
  const pts = el.waypoints ?? [{ x: el.x ?? 0, y: el.y ?? 0 }, { x: (el.x ?? 0) + (el.width ?? 0), y: (el.y ?? 0) + (el.height ?? 0) }];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const margin = 220;
  viewer.get<{ viewbox(b: { x: number; y: number; width: number; height: number }): void }>('canvas').viewbox({
    x: Math.min(...xs) - margin,
    y: Math.min(...ys) - margin / 2,
    width: Math.max(...xs) - Math.min(...xs) + 2 * margin,
    height: Math.max(...ys) - Math.min(...ys) + margin,
  });
}

onMounted(render);
watch(() => [props.xml, props.statuses], render);
watch(() => props.focus, focusOn);
defineExpose({ focusOn });
onBeforeUnmount(() => viewer?.destroy());
</script>

<template>
  <div class="diagram-wrap">
    <div class="legend small">
      <span><i class="sw covered" />capturé</span><span><i class="sw traversed" />traversé</span><span><i class="sw missing" />manquant</span>
      <span><i class="sw unlinked" />sans lien</span><span><i class="sw excluded" />exclu</span>
      <span v-if="props.generated" class="muted">mise en page générée par l'outil (le BPMN n'en a pas)</span>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div ref="host" class="diagram" role="img" aria-label="Diagramme BPMN coloré par statut ; la liste des éléments suit" />
  </div>
</template>

<style scoped>
.diagram { height: 520px; background: #f6f7f9; border-radius: 8px; border: 1px solid var(--rule); }
.legend { display: flex; gap: 14px; margin-bottom: 8px; color: var(--text-2); flex-wrap: wrap; }
.small { font-size: 12px; }
.sw { display: inline-block; width: 14px; height: 4px; border-radius: 2px; margin-right: 6px; vertical-align: 3px; }
.sw.covered { background: var(--covered); }
.sw.traversed { background: var(--traversed); }
.sw.missing { background: var(--missing); }
.sw.unlinked { background: #7d8796; outline: 1px dashed #7d8796; }
.sw.excluded { background: #c2c7cf; }
</style>

<style>
/* Marqueurs de statut sur les formes bpmn-js (DOM hors du composant). */
.djs-element.cc-covered .djs-visual > :first-child { stroke: #0ca30c !important; stroke-width: 4px !important; }
.djs-element.cc-traversed .djs-visual > :first-child { stroke: #d99a00 !important; stroke-width: 4px !important; }
.djs-element.cc-missing .djs-visual > :first-child { stroke: #d03b3b !important; stroke-width: 4px !important; }
.djs-element.cc-unlinked .djs-visual > :first-child { stroke: #7d8796 !important; stroke-width: 3px !important; stroke-dasharray: 6 4; }
.djs-element.cc-excluded .djs-visual > :first-child { stroke: #c2c7cf !important; }
.djs-connection.cc-covered .djs-visual > path { stroke: #0ca30c !important; stroke-width: 3px !important; }
.djs-connection.cc-traversed .djs-visual > path { stroke: #d99a00 !important; stroke-width: 3px !important; }
.djs-connection.cc-missing .djs-visual > path { stroke: #d03b3b !important; stroke-width: 3px !important; }
.djs-connection.cc-unlinked .djs-visual > path { stroke: #7d8796 !important; stroke-dasharray: 6 4; }
</style>
