/**
 * Contrat JSON entre le moteur et l'interface (§2.3). L'UI n'importe que des
 * types d'ici : elle ne connaît du moteur que ce qu'il imprime.
 */

export type RepoKey = 'workflow' | 'front' | 'e2e';

export interface RepoInfo {
  key: RepoKey;
  /** Chemin absolu résolu (convention du poste ou variable d'environnement). */
  path: string;
  /** Variable d'environnement qui le surcharge. */
  envVar: string;
  overridden: boolean;
  exists: boolean;
}

export interface PathCheck {
  path: string;
  exists: boolean;
}

/** Prêt : tout est trouvé. Incomplet : config valide mais sources absentes. Invalide : config fautive. */
export type JourneyStatus = 'ready' | 'incomplete' | 'invalid';

export interface JourneySummary {
  id: string;
  label: string;
  pilot: boolean;
  status: JourneyStatus;
  sessions: string[];
  locales: string[];
  nominalPaths: number;
  bpmnDir: PathCheck;
  frontPackage: PathCheck;
  specs: PathCheck[];
  issues: { field: string; message: string }[];
}

export interface JourneysResult {
  repos: RepoInfo[];
  journeys: JourneySummary[];
}
