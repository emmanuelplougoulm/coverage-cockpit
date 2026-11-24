/** Agents IA (§13) : contrat des runs détachés, partagé moteur ↔ UI. */

export type RunKind = 'generation' | 'request' | 'onboarding' | 'case-draft' | 'sdk-analysis';

/** Dossier de stockage par type (§10). */
export const RUN_DIRS: Record<RunKind, string> = {
  generation: 'generations',
  request: 'requests',
  onboarding: 'onboardings',
  'case-draft': 'aio-cases',
  'sdk-analysis': 'sdk-analyses',
};

export const RUN_LABEL: Record<RunKind, string> = {
  generation: 'Nouveau test',
  request: 'Demande',
  onboarding: 'Onboarding',
  'case-draft': 'Cas de test',
  'sdk-analysis': 'Analyse SDK',
};

/** running : un tour tourne ; waiting : l'agent attend une réponse ; closed : clôturé par l'utilisateur. */
export type RunStatus = 'running' | 'waiting' | 'failed' | 'stopped' | 'closed';

export interface Turn {
  n: number;
  /** Texte envoyé à l'agent pour ce tour (demande ou réponse de l'utilisateur). */
  prompt: string;
  phase?: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  /** Coût cumulé annoncé par la CLI à la fin du tour, et coût du tour (différence). */
  cost?: number;
  costDelta?: number;
  /** Textes de l'agent pendant le tour. */
  messages: string[];
  /** Outils utilisés (noms), pour l'avancement. */
  tools: string[];
  result?: string;
  error?: string;
}

export interface RunState {
  id: string;
  kind: RunKind;
  journey: string | null;
  title: string;
  /** Modèle épinglé au départ, réutilisé à chaque reprise. */
  model: string;
  sessionId: string | null;
  status: RunStatus;
  phase?: string;
  branch?: string | null;
  cwd: string;
  pid?: number | null;
  createdAt: string;
  updatedAt: string;
  turns: Turn[];
  totalCost: number;
  /** Dernières questions posées par l'agent (affichées à part). */
  questions: string[];
  /** Notes du moteur (branche non changée, modifications de l'utilisateur…). */
  notes: string[];
}

export type RunSummary = Pick<RunState, 'id' | 'kind' | 'journey' | 'title' | 'model' | 'status' | 'phase' | 'branch' | 'createdAt' | 'updatedAt' | 'totalCost'> & {
  turns: number;
  lastMessage: string | null;
};

export interface SpendSummary {
  total: number;
  today: number;
  byKind: Record<string, number>;
  byJourney: Record<string, number>;
  runs: number;
}

export interface BranchChoice {
  isGit: boolean;
  current: { branch: string | null; canStay: boolean; sameJourney: boolean; dirty: boolean; reason?: string };
  proposed: { name: string; base: string; refreshMain: boolean };
}
