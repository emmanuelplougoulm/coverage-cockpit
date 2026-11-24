/** Connaissance versionnée (§14), telle que le moteur la lit dans `knowledge/`. */

export type Confidence = 'haute' | 'moyenne' | 'basse';

export type DecisionKind = 'branch' | 'excludeState' | 'excludeTemplate' | 'excludeBpmnStep' | 'technicalStep';

export interface Decision {
  id: string;
  kind: DecisionKind;
  why: string;
  /** Parcours où la décision a été validée (= confiance). */
  journeys: string[];
  /** Parcours qui ont décidé autrement : la décision ne s'y applique pas. */
  exceptions: string[];
  /** branch : nom d'événement / de flux (regex). */
  event?: string;
  /** branch : sous-processus (regex sur l'id), facultatif. */
  subprocess?: string;
  /** branch : `none` | `email:<regex>` | `step:<regex>`. */
  links?: string;
  /** Autres genres : regex sur l'état, le gabarit ou le sous-processus. */
  pattern?: string;
}

export interface BrickRule {
  match: string;
  brick: string;
  confidence: Confidence;
  note?: string;
}

export interface Bricks {
  bricks: { id: string; label: string }[];
  front: BrickRule[];
  states: BrickRule[];
  subprocesses: BrickRule[];
}

export type Layer = 'MO' | 'Client' | 'Document' | 'API' | 'E-mail' | 'Test';

export interface Intention {
  id: string;
  label: string;
  /** Méthodes ou fonctions de contrôle (`Classe.méthode` ou `fonction`) qui réalisent l'intention. */
  checks: string[];
  layer: Layer;
  core: boolean;
}

export interface ControlPattern {
  steps: string[];
  modes: string[];
  intentions: Intention[];
}

export interface Expectation {
  kind: 'session' | 'email' | 'branch';
  name: string;
  expect: string[];
}

export interface Knowledge {
  decisions: Decision[];
  bricks: Bricks;
  patterns: Record<string, ControlPattern>;
  expectations: Expectation[];
}

/** Brique attribuée à un groupe, un état ou un sous-processus. */
export interface BrickAssignment {
  ref: string;
  brick: string | null;
  confidence: Confidence | null;
  note?: string;
  rule?: string;
}

// ——— audit des assertions (§14) ———

export type Strength = 'valeur' | 'presence' | 'visuel';

export interface AuditedControl {
  test: { id: string; file: string; line: number };
  check: string;
  strength: Strength;
  layer: Layer | null;
  /** Intentions que ce contrôle réalise (un même contrôle peut en servir plusieurs). */
  intentions: string[];
  brick: string | null;
}

export type FactStatus = 'missing' | 'reached' | 'controlled' | 'excluded' | 'unlinked';

export interface AuditedFact {
  id: string;
  kind: 'session' | 'email' | 'branch';
  label: string;
  brick: string | null;
  status: FactStatus;
  reason?: string;
  reachedBy: { id: string; file: string; line: number }[];
  expected: { id: string; label: string; layer: Layer }[];
  /** Intention → tests (qui atteignent le fait) qui la contrôlent. */
  controlledBy: Record<string, string[]>;
  missingIntentions: string[];
  /** Tests qui atteignent le fait sans contrôler aucune intention attendue. */
  traversedOnly: string[];
}

export interface AssertionAudit {
  journey: string;
  controls: AuditedControl[];
  /** Gardes : ce que les actions attendent ; comptées, jamais affichées comme preuves. */
  guards: number;
  byLayer: Record<string, { count: number; valeur: number; presence: number; visuel: number }>;
  intentions: { id: string; label: string; brick: string; layer: Layer; core: boolean; tests: string[] }[];
  facts: AuditedFact[];
  /** Taux « contrôlé » : un MAJORANT (lien fait par test, pas par étape). */
  rate: { controlled: number; reached: number; total: number };
}
