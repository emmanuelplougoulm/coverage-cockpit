import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fichiers réellement lus par une analyse (§10, `inputsKey`) : contenu des
 * fichiers lus et liste des dossiers parcourus. Si rien de tout cela n'a
 * changé, l'analyse donnerait le même résultat, même si le dépôt a bougé ailleurs.
 */

export interface InputRecord {
  /** Chemin absolu → hash du contenu (`absent` si le fichier n'existe pas). */
  files: Record<string, string>;
  /** Dossier absolu → hash de la liste récursive de ses fichiers. */
  listings: Record<string, string>;
}

const hashFile = (abs: string): string => {
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex');
  } catch {
    return 'absent';
  }
};

function listing(abs: string): string {
  if (!existsSync(abs)) return 'absent';
  if (!statSync(abs).isDirectory()) return 'file';
  const names: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const f of readdirSync(dir).sort()) {
      if (f === 'node_modules' || f === '.git') continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, `${prefix}${f}/`);
      else names.push(`${prefix}${f}`);
    }
  };
  walk(abs, '');
  return createHash('sha256').update(names.join('\n')).digest('hex');
}

export class InputLog {
  private readonly files = new Map<string, string>();
  private readonly listings = new Map<string, string>();

  file(abs: string): void {
    if (!this.files.has(abs)) this.files.set(abs, hashFile(abs));
  }

  dir(abs: string): void {
    if (!this.listings.has(abs)) this.listings.set(abs, listing(abs));
  }

  record(): InputRecord {
    const sorted = (m: Map<string, string>) => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return { files: sorted(this.files), listings: sorted(this.listings) };
  }
}

/** Les entrées enregistrées sont-elles toujours identiques sur disque ? */
export function inputsUnchanged(rec: InputRecord): boolean {
  for (const [abs, h] of Object.entries(rec.files)) if (hashFile(abs) !== h) return false;
  for (const [abs, h] of Object.entries(rec.listings)) if (listing(abs) !== h) return false;
  return true;
}

export function inputsKey(rec: InputRecord, toolKey: string): string {
  return createHash('sha256').update(toolKey).update(JSON.stringify(rec)).digest('hex');
}
