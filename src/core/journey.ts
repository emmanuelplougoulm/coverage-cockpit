/**
 * Configuration d'un parcours (§4). Une config = un module TypeScript par parcours.
 *
 * Principe : ce que le code dit est automatique ; le périmètre est une décision
 * humaine. Toute exclusion ou tout arbitrage vit ici, avec un commentaire qui
 * en donne la raison.
 */

export interface NominalPath {
  id: string;
  label: string;
  /** États "GROUP.KEY" dans l'ordre du parcours. */
  screens: string[];
  /** Cas + entrée, remis tel quel à l'IA. */
  setup: string;
  /** Clé de cas proche, point de départ conseillé. */
  from?: string;
}

export interface JourneyConfig {
  /** Identifiant du processus BPMN. */
  id: string;
  label: string;
  /** Groupe de constantes front (ex. SCAN_ID_STEPS) → nom affiché, DANS L'ORDRE du parcours. */
  sessions: Record<string, string>;
  /** Relatif à [REPO-WORKFLOW]. */
  bpmnDir: string;
  /** Relatif à [REPO-FRONT]. */
  frontPackage: string;
  /** Relatifs à [REPO-E2E]. */
  specs: string[];
  /** Specs partagées : leurs tests ne comptent que s'ils appellent un configurateur du parcours. */
  sharedSpecs?: string[];
  /** Fonctions qui créent les cas de ce parcours. */
  caseConfigurers?: string[];
  /** Chaque écran / e-mail doit être couvert dans chacune. */
  locales: string[];
  /** Langue d'un cas qui n'en fixe pas. */
  defaultLocale?: string;
  /** Un chemin nominal par canal ; sinon celui du 1er test workflow @P1. */
  nominalPaths?: NominalPath[];
  /** Écrans dont la clé dit « erreur technique » mais qui terminent une escalade. */
  escalationEnds?: string[];
  /** Groupes hors périmètre (sessions hébergées par un tiers). */
  excludedGroups: string[];
  /** "GROUP.KEY" hors périmètre. */
  excludedStates: string[];
  /** Sous-processus hors périmètre. */
  excludedBpmnSteps: string[];
  /** Déclencheurs d'e-mails hors périmètre (relances / minuteries = `timer`). */
  excludedEmailTriggers: string[];
  excludedEmailTemplates?: string[];
  /** Sous-processus → sessions front, quand son input `sessionName` est variable ou différent. */
  bpmnSessions?: Record<string, string[]>;
  /** Sous-processus sans écran (archivage, init) : branches non listées. */
  bpmnTechnicalSteps?: string[];
  /**
   * "sous-processus/élément" → états ("GROUP.KEY") ou e-mails ("email:<template>")
   * qui PROUVENT que la branche a été prise ; [] = rien de visible ne le prouve.
   */
  bpmnBranches?: Record<string, string[]>;
  /** D'où vient l'entrée de bpmnBranches (config ou « catalogue <id> »), posé par le moteur. */
  bpmnBranchSources?: Record<string, string>;
  /** Hérite du catalogue de décisions là où la config ne dit rien. */
  catalog?: boolean;
  /** Capture d'e-mail → variante (min/max) quand le code ne peut pas compter les documents. */
  emailCaptureVariants?: Record<string, string>;
  /** "Classe.méthode" → état affiché sans classe `step-`. */
  methodStates?: Record<string, string>;
  /** Classe d'étape ambiguë → "GROUP.KEY" tranché à la main. */
  stepAliases?: Record<string, string>;
}

/** Un état d'écran s'écrit "GROUP.KEY" ; GROUP en capitales (constante front). */
export const STATE_REF = /^[A-Z][A-Z0-9_]*\.[A-Za-z0-9_]+$/;
export const EMAIL_REF = /^email:[A-Za-z0-9_.\-/]+$/;
export const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * Langue appliquée à un cas qui n'en fixe pas (§4) :
 * defaultLocale, sinon l'unique langue, sinon null (« langue inconnue », zone grise).
 */
export function fallbackLocale(config: Pick<JourneyConfig, 'locales' | 'defaultLocale'>): string | null {
  if (config.defaultLocale) return config.defaultLocale;
  if (config.locales.length === 1) return config.locales[0] ?? null;
  return null;
}
