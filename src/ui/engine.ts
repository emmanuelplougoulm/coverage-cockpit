import { invoke } from '@tauri-apps/api/core';

/**
 * Seule frontière UI ↔ moteur (§2.3) : `run_engine(args[]) → string JSON`.
 *
 * Dans Tauri : la commande Rust. Dans un navigateur (`pnpm dev` seul) : le
 * relais de développement de Vite, qui lance le même CLI. Les deux renvoient
 * exactement ce que le moteur imprime.
 */
export async function runEngine<T>(args: string[]): Promise<T> {
  const raw = '__TAURI_INTERNALS__' in window ? await invoke<string>('run_engine', { args }) : await viaDevRelay(args);
  return JSON.parse(raw) as T;
}

async function viaDevRelay(args: string[]): Promise<string> {
  if (!import.meta.env.DEV) throw new Error('Moteur indisponible hors de l’app et hors du mode développement.');
  const res = await fetch('/__engine', { method: 'POST', body: JSON.stringify(args) });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `moteur : HTTP ${res.status}`);
  return text;
}
