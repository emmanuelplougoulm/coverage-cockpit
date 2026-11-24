import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { CaptureRef, CoverageView } from '../core/coverage';

/**
 * Images de référence des captures (convention Playwright) :
 * `<spec>-snapshots/<nom sans extension>-<projet>-<plateforme>.png`.
 * Lecture seule dans le dépôt de tests ; miniatures en cache dans le dossier
 * de données (jamais dans le dépôt).
 */

export function findReferenceImage(e2eRoot: string, specFile: string, shot: string): string | null {
  const dir = join(e2eRoot, `${specFile}-snapshots`);
  if (!existsSync(dir)) return null;
  const base = shot.replace(/\.png$/i, '').replace(/[\\/]/g, '-');
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  const hit = files.find((f) => f === `${base}.png`) ?? files.find((f) => f.startsWith(`${base}-`) && /^[\w]+-[\w]+\.png$/.test(f.slice(base.length + 1)));
  return hit ? relative(e2eRoot, join(dir, hit)).split(sep).join('/') : null;
}

/** Complète `capturedBy[].image` dans les vues (écrans et e-mails). */
export function attachImages(view: CoverageView, e2eRoot: string): CoverageView {
  const fill = (c: CaptureRef): CaptureRef => {
    if (!c.shot) return c;
    const image = findReferenceImage(e2eRoot, c.file, c.shot);
    return image ? { ...c, image } : c;
  };
  return {
    ...view,
    sessions: view.sessions.map((s) => ({
      ...s,
      states: s.states.map((st) => ({
        ...st,
        byLocale: Object.fromEntries(Object.entries(st.byLocale).map(([l, c]) => [l, { ...c, capturedBy: c.capturedBy.map(fill) }])),
      })),
    })),
    emails: view.emails.map((e) => ({
      ...e,
      variants: e.variants.map((v) => ({
        ...v,
        byLocale: Object.fromEntries(Object.entries(v.byLocale).map(([l, c]) => [l, { ...c, capturedBy: c.capturedBy.map(fill) }])),
      })),
    })),
  };
}

/** Chemin d'image sûr : relatif, dans le dépôt de tests, en .png. */
export function safeImagePath(e2eRoot: string, rel: string): string {
  const abs = resolve(e2eRoot, rel);
  if (!rel.endsWith('.png') || !abs.startsWith(resolve(e2eRoot) + sep)) throw new Error(`image refusée : ${rel}`);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`image introuvable : ${rel}`);
  return abs;
}

export const dataUrl = (abs: string): string => `data:image/png;base64,${readFileSync(abs).toString('base64')}`;
export const contentHash = (abs: string): string => createHash('sha256').update(readFileSync(abs)).digest('hex');

/** Miniature (largeur ≤ 360 px) via `sips` (macOS), en cache par empreinte du contenu. */
export function thumbnail(abs: string, cacheDir: string): string {
  const out = join(cacheDir, `${contentHash(abs)}.png`);
  if (!existsSync(out)) {
    mkdirSync(dirname(out), { recursive: true });
    try {
      execFileSync('sips', ['-Z', '360', abs, '--out', out], { stdio: 'ignore' });
    } catch {
      return abs; // pas de sips : on sert l'image d'origine
    }
  }
  return out;
}
