import type { CoverageView, Suite } from './coverage';
import type { CellStatus } from './fixture';

/** Historique (§10) : une ligne par analyse ayant changé quelque chose. */

export interface SourceState {
  commit: string | null;
  branch: string | null;
  dirty: boolean;
}

export interface Snapshot {
  at: string;
  journey: string;
  suite: Suite;
  sources: { tests: SourceState; front: SourceState; workflow: SourceState };
  testsScanned: number;
  cells: Record<string, CellStatus>;
}

/** Vrai si la couverture a changé depuis l'instantané précédent. */
export function snapshotChanged(prev: Snapshot | undefined, next: Pick<Snapshot, 'testsScanned' | 'cells'>): boolean {
  if (!prev) return true;
  if (prev.testsScanned !== next.testsScanned) return true;
  const a = Object.keys(prev.cells);
  const b = Object.keys(next.cells);
  return a.length !== b.length || b.some((k) => prev.cells[k] !== next.cells[k]);
}

/** Cache : comment la vue a été obtenue. */
export type CacheStatus = 'hit' | 'inputs' | 'miss' | 'forced';

export interface CacheInfo {
  status: CacheStatus;
  key: string;
  /** Date de l'analyse qui a produit la vue. */
  analyzedAt: string;
  /** Durée de cet appel, en ms. */
  ms: number;
  /** Instantané ajouté à l'historique pour cette suite. */
  historyAppended: boolean;
}

/** Dernière vue enregistrée d'un parcours (sous-commande `last-views`). */
export interface LastViews {
  journey: string;
  at: string;
  views: Record<Suite, CoverageView>;
}

/** Sortie de la sous-commande `coverage`. */
export interface CoverageResult {
  view: CoverageView;
  cache: CacheInfo;
}
