/** Cas de test (§9, §12) : contrat partagé moteur ↔ UI. */

export interface CaseStep {
  action: string;
  data: string;
  expected: string;
  /** Capture de l'étape (nom), jointe à la création. */
  rendering: string;
}

export interface CaseDraft {
  title: string;
  description: string;
  preconditions: string;
  steps: CaseStep[];
}

export type CaseStatus = 'Brouillon' | 'Publié' | 'Automatisé';

export interface CaseLink {
  /** Titre complet du test. */
  test: string;
  journey: string;
  key: string;
  /** Clé déjà présente dans le test (tag) ou seulement connue de l'outil. */
  inTest: boolean;
}

export interface CaseRow {
  test: string;
  file: string;
  line: number;
  /** Clé lue dans les tags (`@<PROJ>-TC-<n>`), `TODO` pour un cas à créer, null sinon. */
  tagKey: string | null;
  link: CaseLink | null;
  status: CaseStatus | 'n’existe plus' | null;
}

/** Extrait le brouillon JSON du dernier message de l'agent (bloc ```json …```). */
export function parseCaseDraft(text: string | null | undefined): CaseDraft | null {
  if (!text) return null;
  const block = /```json\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  try {
    const o = JSON.parse(block) as Partial<CaseDraft>;
    if (typeof o.title !== 'string' || !Array.isArray(o.steps)) return null;
    return {
      title: o.title,
      description: String(o.description ?? ''),
      preconditions: String(o.preconditions ?? ''),
      steps: o.steps.map((s) => ({ action: String(s?.action ?? ''), data: String(s?.data ?? ''), expected: String(s?.expected ?? ''), rendering: String(s?.rendering ?? '') })),
    };
  } catch {
    return null;
  }
}

/**
 * Clé de cas dans des tags (du describe extérieur à l'option du test) : la plus
 * proche du test l'emporte. Limite connue : un test à deux clés n'est géré qu'à moitié.
 */
export function caseKeyOf(tags: string[]): string | null {
  for (const t of [...tags].reverse()) {
    const m = /^@([A-Z][A-Z0-9]*-TC-(\d+|TODO))$/.exec(t);
    if (m) return m[2] === 'TODO' ? 'TODO' : m[1]!;
  }
  return null;
}
