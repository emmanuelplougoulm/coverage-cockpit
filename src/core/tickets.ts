/** Tickets (§9, §12) : lecture seule, contrat moteur ↔ UI. */

export type HintKind = 'bpmn-field' | 'case-keys' | 'description' | 'title-bracket' | 'taxonomy' | 'epic';

export const HINT_LABEL: Record<HintKind, string> = {
  'bpmn-field': 'champ « nom du BPMN »',
  'case-keys': 'clés de cas citées',
  description: 'nom du BPMN dans la description',
  'title-bracket': 'mot entre crochets du titre',
  taxonomy: 'champ de taxonomie',
  epic: 'epic',
};

export interface Hint {
  kind: HintKind;
  /** Parcours désignés par cet indice. */
  journeys: string[];
  evidence: string;
}

export interface Ticket {
  key: string;
  summary: string;
  /** Description en texte (wiki nettoyé), tronquée. */
  description: string;
  status: string;
  statusCategory: 'new' | 'indeterminate' | 'done' | string;
  type: string;
  sprints: { name: string; state: 'ACTIVE' | 'FUTURE' | 'CLOSED' | string }[];
  epic: string | null;
  url: string | null;
  /** Parcours déduit : le premier indice qui désigne UN SEUL parcours. */
  journey: string | null;
  decidedBy: HintKind | null;
  hints: Hint[];
  /** Un autre indice désigne un autre parcours. */
  divergent: boolean;
}

export interface TicketsResult {
  configured: boolean;
  source: 'jira' | 'fake' | null;
  tickets: Ticket[];
  /** Ticket de campagne par parcours (= branche du dépôt de tests). */
  campaign: Record<string, string>;
  error?: string;
}
