import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Empreinte d'un dépôt ou de chemins d'un dépôt (§10) : objets git de l'index
 * (`ls-files --stage`) + hash des modifications non commitées (diff du
 * worktree, fichiers non suivis par taille et date). Hors git : taille et date
 * de chaque fichier. Lecture seule : aucune commande git qui écrit.
 */

export interface GitInfo {
  commit: string | null;
  branch: string | null;
  dirty: boolean;
}

const SKIP = new Set(['node_modules', '.git']);

export function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

export const isGitTree = (root: string): boolean => git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';

const statLine = (abs: string, label: string): string => {
  try {
    const s = statSync(abs);
    return `${label}\0${s.size}\0${Math.round(s.mtimeMs)}`;
  } catch {
    return `${label}\0absent`;
  }
};

function walk(abs: string, out: string[]): void {
  if (!existsSync(abs)) return;
  const s = statSync(abs);
  if (!s.isDirectory()) {
    out.push(abs);
    return;
  }
  for (const f of readdirSync(abs).sort()) if (!SKIP.has(f)) walk(join(abs, f), out);
}

/** `paths` relatifs à `root` ; `null` = tout le dépôt. */
export function fingerprint(root: string, paths: string[] | null): string {
  const h = createHash('sha256');
  const specs = paths && paths.length ? paths : ['.'];
  if (!existsSync(root)) return `absent:${root}`;
  if (isGitTree(root)) {
    h.update('git\0');
    h.update(git(root, ['ls-files', '--stage', '--', ...specs]) ?? '');
    h.update('\0diff\0');
    h.update(git(root, ['diff', '--no-ext-diff', '--binary', '--', ...specs]) ?? '');
    h.update('\0untracked\0');
    const untracked = (git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...specs]) ?? '').split('\0').filter(Boolean).sort();
    for (const f of untracked) h.update(statLine(join(root, f), f) + '\n');
  } else {
    h.update('fs\0');
    for (const p of specs) {
      const files: string[] = [];
      walk(join(root, p), files);
      if (!files.length) h.update(`${p}\0absent\n`);
      for (const f of files) h.update(statLine(f, relative(root, f).split(sep).join('/')) + '\n');
    }
  }
  return h.digest('hex');
}

/** Commit, branche et état propre / modifié des chemins (instantané d'historique). */
export function gitInfo(root: string, paths: string[] | null): GitInfo {
  if (!existsSync(root) || !isGitTree(root)) return { commit: null, branch: null, dirty: false };
  const commit = git(root, ['rev-parse', 'HEAD'])?.trim() || null;
  // symbolic-ref : nom de branche même sans commit ; échoue en HEAD détachée (null).
  const branch = git(root, ['symbolic-ref', '-q', '--short', 'HEAD'])?.trim() || null;
  const status = git(root, ['status', '--porcelain', '--', ...(paths && paths.length ? paths : ['.'])]) ?? '';
  return { commit, branch, dirty: status.trim().length > 0 };
}

export const sha256 = (...parts: string[]): string => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p + '\0');
  return h.digest('hex');
};
