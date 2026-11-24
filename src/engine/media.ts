import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { CoverageView, Suite } from '../core/coverage';
import type { ThumbnailsResult } from '../core/media';
import { contentHash, dataUrl, safeImagePath, thumbnail } from './images';

/** Miniatures de toutes les captures des deux suites, et doublons de rendu. */
export function thumbnailsOf(journey: string, views: Record<Suite, CoverageView>, e2eRoot: string, dataDir: string): ThumbnailsResult {
  const byImage = new Map<string, ThumbnailsResult['thumbnails'][number]>();
  const use = (image: string | undefined, ref: string, locale: string, suite: Suite, test: string) => {
    if (!image) return;
    let t = byImage.get(image);
    if (!t) {
      const abs = safeImagePath(e2eRoot, image);
      t = { image, thumb: dataUrl(thumbnail(abs, join(dataDir, 'thumbnails'))), hash: contentHash(abs), uses: [] };
      byImage.set(image, t);
    }
    t.uses.push({ ref, locale, suite, test });
  };
  for (const suite of ['ui', 'workflow'] as const) {
    const v = views[suite];
    for (const s of v.sessions) {
      for (const st of s.states) {
        for (const [loc, c] of Object.entries(st.byLocale)) for (const cap of c.capturedBy) use(cap.image, `${st.group}.${st.key}`, loc, suite, cap.id);
      }
    }
    for (const e of v.emails) {
      for (const va of e.variants) {
        for (const [loc, c] of Object.entries(va.byLocale)) for (const cap of c.capturedBy) use(cap.image, `email:${e.template}/${va.variant}`, loc, suite, cap.id);
      }
    }
  }
  const thumbnails = [...byImage.values()];
  const byHash = new Map<string, typeof thumbnails>();
  for (const t of thumbnails) byHash.set(t.hash, [...(byHash.get(t.hash) ?? []), t]);
  const duplicates = [...byHash.entries()]
    .map(([hash, ts]) => ({ hash, images: ts.map((t) => t.image), refs: [...new Set(ts.flatMap((t) => t.uses.map((u) => u.ref)))] }))
    .filter((d) => d.refs.length > 1);
  return { journey, thumbnails, duplicates };
}

/** Image en taille réelle (data URL), ou ouverte dans l'app par défaut du système. */
export function imageOf(e2eRoot: string, rel: string, open: boolean): { image: string; data?: string; opened?: boolean } {
  const abs = safeImagePath(e2eRoot, rel);
  if (open) {
    execFileSync('open', [abs]);
    return { image: rel, opened: true };
  }
  return { image: rel, data: dataUrl(abs) };
}
