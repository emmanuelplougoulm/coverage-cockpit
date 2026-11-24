import { EMAIL_REF, LOCALE, STATE_REF, type JourneyConfig } from './journey';

export interface ConfigIssue {
  journey: string;
  field: string;
  message: string;
}

/**
 * Contrôles de forme d'une config de parcours. Fonction pure : ne lit rien sur
 * disque. Les contrôles de présence (dossiers, specs) sont faits par le moteur.
 */
export function validateConfig(c: JourneyConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const add = (field: string, message: string) => issues.push({ journey: c.id || '?', field, message });

  if (!c.id.trim()) add('id', 'identifiant de processus vide');
  if (!c.label.trim()) add('label', 'libellé vide');
  if (Object.keys(c.sessions).length === 0) add('sessions', 'aucune session déclarée');
  if (!c.bpmnDir.trim()) add('bpmnDir', 'dossier BPMN vide');
  if (!c.frontPackage.trim()) add('frontPackage', 'package front vide');
  if (c.specs.length === 0) add('specs', 'aucune spec déclarée');

  if (c.locales.length === 0) add('locales', 'aucune langue');
  for (const l of c.locales) if (!LOCALE.test(l)) add('locales', `langue mal formée : ${l}`);
  if (new Set(c.locales).size !== c.locales.length) add('locales', 'langue en double');
  if (c.defaultLocale && !c.locales.includes(c.defaultLocale)) {
    add('defaultLocale', `${c.defaultLocale} n'est pas dans locales`);
  }

  const groups = new Set(Object.keys(c.sessions));
  for (const g of c.excludedGroups) {
    if (!groups.has(g)) add('excludedGroups', `groupe exclu inconnu des sessions : ${g}`);
  }
  for (const s of c.excludedStates) {
    if (!STATE_REF.test(s)) add('excludedStates', `état mal formé (attendu GROUP.KEY) : ${s}`);
  }

  const paths = c.nominalPaths ?? [];
  const pathIds = new Set<string>();
  for (const p of paths) {
    if (pathIds.has(p.id)) add('nominalPaths', `chemin nominal en double : ${p.id}`);
    pathIds.add(p.id);
    if (p.screens.length === 0) add('nominalPaths', `chemin ${p.id} sans écran`);
    for (const s of p.screens) {
      if (!STATE_REF.test(s)) add('nominalPaths', `chemin ${p.id} : état mal formé ${s}`);
    }
  }

  for (const [branch, proofs] of Object.entries(c.bpmnBranches ?? {})) {
    if (!branch.includes('/')) add('bpmnBranches', `clé attendue "sous-processus/élément" : ${branch}`);
    for (const p of proofs) {
      if (!STATE_REF.test(p) && !EMAIL_REF.test(p)) {
        add('bpmnBranches', `${branch} : preuve mal formée (GROUP.KEY ou email:<template>) ${p}`);
      }
    }
  }

  for (const [field, map] of [
    ['stepAliases', c.stepAliases],
    ['methodStates', c.methodStates],
  ] as const) {
    for (const [k, v] of Object.entries(map ?? {})) {
      if (!STATE_REF.test(v)) add(field, `${k} → état mal formé ${v}`);
    }
  }

  return issues;
}

/** Contrôles qui portent sur l'ensemble des parcours (identifiants uniques). */
export function validateConfigs(configs: JourneyConfig[]): ConfigIssue[] {
  const seen = new Set<string>();
  const issues = configs.flatMap(validateConfig);
  for (const c of configs) {
    if (seen.has(c.id)) issues.push({ journey: c.id, field: 'id', message: 'identifiant de parcours en double' });
    seen.add(c.id);
  }
  return issues;
}
