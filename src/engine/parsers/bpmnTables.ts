/**
 * Tables de connaissance du dialecte BPMN de la plateforme (§5.1). Ajouter un
 * worker ou un message ici suffit à le faire reconnaître partout.
 */

/** Worker de « session client » → type de session. */
export const SESSION_WORKERS: Record<string, string> = {
  'client-session': 'session',
  'client-session-v2': 'session',
};

/** Statuts de session, dans l'ordre canonique. */
export const SESSION_STATUSES = ['processed', 'submitted', 'signed', 'choice-submitted', 'blocked', 'canceled'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Message de statut → statut. */
export const SESSION_MESSAGES: Record<string, SessionStatus> = {
  'session-processed': 'processed',
  'session-submitted': 'submitted',
  'session-signed': 'signed',
  'session-choice-submitted': 'choice-submitted',
  'session-blocked': 'blocked',
  'session-canceled': 'canceled',
};

/** Worker d'e-mail → version d'API (v4 : modèle dans `payload`, objet dans `subject`). */
export const EMAIL_WORKERS: Record<string, 'v3' | 'v4'> = {
  'send-email': 'v3',
  'send-email-v4': 'v4',
};

/** Messages de décision back-office. */
export const DECISION_MESSAGES: Record<string, string> = {
  'back-office-decision': 'decision',
};
