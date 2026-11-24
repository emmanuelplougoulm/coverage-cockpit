<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import '@xterm/xterm/css/xterm.css';
import { inTauri } from '../store';

/**
 * Terminal Claude intégré (§3, §15) : un pseudo-terminal Tauri (shell de
 * connexion qui lance `claude` s'il existe) affiché par xterm. Une seule
 * session, gardée vivante entre l'onglet et le panneau (⌘J).
 */
const props = defineProps<{ cwd: string | null; visible: boolean }>();
const host = ref<HTMLDivElement | null>(null);
const error = ref<string | null>(null);
let term: import('@xterm/xterm').Terminal | null = null;
let fit: import('@xterm/addon-fit').FitAddon | null = null;
let id: number | null = null;
const unlisten: (() => void)[] = [];

async function start() {
  if (!inTauri() || !host.value || term) return;
  try {
    const [{ Terminal }, { FitAddon }, { invoke }, { listen }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);
    term = new Terminal({ fontFamily: 'ui-monospace, SF Mono, Menlo, monospace', fontSize: 13, theme: { background: '#0f1318', foreground: '#e3e8ee' }, cursorBlink: true });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.value);
    fit.fit();
    id = await invoke<number>('pty_start', { cwd: props.cwd ?? '', cols: term.cols, rows: term.rows });
    unlisten.push(await listen<{ id: number; data: string }>('pty-data', (e) => e.payload.id === id && term?.write(e.payload.data)));
    unlisten.push(await listen<{ id: number }>('pty-exit', (e) => e.payload.id === id && term?.write('\r\n[session terminée]\r\n')));
    term.onData((d) => id !== null && void invoke('pty_write', { id, data: d }));
    term.onResize(({ cols, rows }) => id !== null && void invoke('pty_resize', { id, cols, rows }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

const refit = () => fit?.fit();
onMounted(() => {
  if (props.visible) void start();
  window.addEventListener('resize', refit);
});
watch(
  () => props.visible,
  async (v) => {
    if (!v) return;
    await nextTick();
    if (!term) await start();
    refit();
    term?.focus();
  },
);
onBeforeUnmount(async () => {
  window.removeEventListener('resize', refit);
  unlisten.forEach((u) => u());
  if (id !== null) {
    const { invoke } = await import('@tauri-apps/api/core');
    void invoke('pty_stop', { id });
  }
  term?.dispose();
});
defineExpose({ refit });
</script>

<template>
  <div class="term">
    <p v-if="!inTauri()" class="muted pad">Le terminal Claude est disponible dans l'app de bureau (pseudo-terminal Tauri) ; pas dans l'aperçu navigateur.</p>
    <p v-else-if="error" class="error pad">{{ error }}</p>
    <div ref="host" class="host" />
  </div>
</template>

<style scoped>
.term { height: 100%; display: flex; flex-direction: column; background: #0f1318; }
.host { flex: 1; min-height: 0; padding: 6px; }
.pad { padding: 12px; }
</style>
