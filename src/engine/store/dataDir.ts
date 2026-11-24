import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Dossier de données de l'app (§10), hors des dépôts. Surchargeable par
 * `CC_DATA_DIR` (tests, corpus). Écritures atomiques : un lecteur ne voit
 * jamais un fichier à moitié écrit.
 */

export const APP_ID = 'app.coverage-cockpit';

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CC_DATA_DIR?.trim();
  return override || join(homedir(), 'Library', 'Application Support', APP_ID);
}

export function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined; // fichier corrompu : traité comme absent, il sera réécrit
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

export function appendJsonl(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(value) + '\n');
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // ligne tronquée (arrêt pendant l'écriture) : ignorée
    }
  }
  return out;
}

/** Nom de fichier sûr pour un identifiant de parcours. */
export const safeName = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, '_');
