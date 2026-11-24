import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Node, Project, type SourceFile } from 'ts-morph';
import { isRecord, readLiteral, type Literal } from './literal';

/**
 * Parseur du package front d'un parcours (§5.2). `parseFront` est pur : il
 * reçoit le contenu des fichiers (chemins relatifs au package) ; seul
 * `loadFrontPackage` lit le disque.
 */

export interface FrontState {
  group: string;
  key: string;
  kind: 'step' | 'message';
  /** Nom d'étape (classe `step-<nom>`) ; absent pour un message. */
  stepName?: string;
  /** Langues dans lesquelles l'état a un texte. */
  locales: string[];
}

export interface FrontTransition {
  from: string;
  to: string[];
}

export interface EmailVariant {
  variant: string;
  locales: string[];
}

export interface EmailTemplate {
  template: string;
  /** Variantes du dossier racine (code de branche, `min` / `max`, `default`). */
  variants: EmailVariant[];
  /** Gammes qui ont leur propre copie du gabarit (sous-dossier de gamme). */
  ranges: Record<string, EmailVariant[]>;
  locales: string[];
}

export interface FrontModel {
  /** Pas de `scripts/constants.ts` : parcours squelette, rien à analyser. */
  skeleton: boolean;
  /** Groupes d'étapes, dans l'ordre de `constants.ts`. */
  groups: string[];
  states: FrontState[];
  /** Graphe brut des cartes d'étapes (base de `stepGraph`). */
  transitions: FrontTransition[];
  locales: string[];
  emails: EmailTemplate[];
  /** Textes par langue et par état ("GROUP.KEY" → champ → texte), base des croquis d'écran. */
  texts: Record<string, Record<string, Record<string, string>>>;
  /** Ce que le parseur a vu sans pouvoir le ranger. */
  warnings: string[];
}

/** Clés de textes qui sont des états d'écran à part entière. */
export const MESSAGE_KEY = /^(internalError|blockedError|lockedError|helperTextOnError|codeHelperTextOnError|serverError\w*|\w+Dialog)$/;

/** Groupe des messages communs au parcours (page d'erreur). */
export const JOURNEY_GROUP = 'JOURNEY';

/** Classes SDK qui désignent un état sans classe `step-`. */
export const SDK_CLASS_MARKERS: Record<string, string> = {
  'journey-error': `${JOURNEY_GROUP}.internalError`,
};

export interface Marker {
  kind: 'class' | 'id';
  value: string;
}

/**
 * États qu'un marqueur DOM peut désigner : la table SDK pour une classe,
 * les messages de même clé pour un id (ex. `#deleteDialog`).
 */
export function markerCandidates(marker: Marker, states: FrontState[]): string[] {
  if (marker.kind === 'class') {
    const s = SDK_CLASS_MARKERS[marker.value];
    return s ? [s] : [];
  }
  return states.filter((s) => s.kind === 'message' && s.key === marker.value).map((s) => `${s.group}.${s.key}`);
}

const LOCALE_FILE = /^scripts\/locales\/([a-z]{2}(?:-[A-Z]{2})?)\.ts$/;
const STEPS_FILE = /^scripts\/steps\/[^/]+\.ts$/;
const STEPS_GROUP = /^[A-Z][A-Z0-9_]*_STEPS$/;

export function parseFront(files: Record<string, string>): FrontModel {
  const warnings: string[] = [];
  const constants = files['scripts/constants.ts'];
  const emailPaths = Object.keys(files).filter((p) => p.startsWith('emails/'));
  if (constants === undefined) {
    return { skeleton: true, groups: [], states: [], transitions: [], locales: [], emails: parseEmails(emailPaths), texts: {}, warnings };
  }

  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const add = (path: string, text: string) => project.createSourceFile(path, text, { overwrite: true });

  // 1. Constantes : GROUP → (KEY → nom d'étape)
  const groups = new Map<string, Record<string, string>>();
  for (const decl of add('scripts/constants.ts', constants).getVariableDeclarations()) {
    const name = decl.getName();
    if (!STEPS_GROUP.test(name)) continue;
    const v = readLiteral(decl.getInitializer());
    if (!isRecord(v)) {
      warnings.push(`constants.ts : ${name} n'est pas un objet littéral`);
      continue;
    }
    const steps: Record<string, string> = {};
    for (const [k, s] of Object.entries(v)) if (typeof s === 'string') steps[k] = s;
    groups.set(name, steps);
  }
  const refs = (text: string): string | undefined => {
    const m = /^([A-Z][A-Z0-9_]*)\.([A-Za-z0-9_]+)$/.exec(text);
    return m && groups.get(m[1]!)?.[m[2]!] !== undefined ? `${m[1]}.${m[2]}` : undefined;
  };

  // 2. Cartes d'étapes : transitions `next`
  const transitions: FrontTransition[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (!STEPS_FILE.test(path)) continue;
    add(path, text).forEachDescendant((node) => {
      if (!Node.isPropertyAssignment(node)) return;
      const nameNode = node.getNameNode();
      if (!Node.isComputedPropertyName(nameNode)) return;
      const from = refs(nameNode.getExpression().getText());
      const card = readLiteral(node.getInitializer(), refs);
      if (!from || !isRecord(card)) return;
      const next = card.next;
      const to = Array.isArray(next) ? next.filter((x): x is string => typeof x === 'string') : typeof next === 'string' ? [next] : [];
      transitions.push({ from, to });
    });
  }

  // 3. Textes par langue
  const texts = new Map<string, Record<string, Literal>>();
  for (const [path, text] of Object.entries(files)) {
    const m = LOCALE_FILE.exec(path);
    if (!m) continue;
    const obj = defaultExportObject(add(path, text));
    if (obj) texts.set(m[1]!, obj);
    else warnings.push(`${path} : pas d'objet littéral exporté par défaut`);
  }
  const locales = [...texts.keys()].sort();

  // 4. États : étapes déclarées, puis messages trouvés dans les textes
  const states: FrontState[] = [];
  const has = (loc: string, group: string, key: string) => {
    const g = texts.get(loc)?.[group];
    return isRecord(g) && g[key] !== undefined;
  };
  for (const [group, steps] of groups) {
    for (const [key, stepName] of Object.entries(steps)) {
      states.push({ group, key, kind: 'step', stepName, locales: locales.filter((l) => has(l, group, key)) });
    }
  }
  const messageGroups = [JOURNEY_GROUP, ...groups.keys()];
  for (const group of messageGroups) {
    const keys = new Set<string>();
    for (const t of texts.values()) {
      const g = t[group];
      if (isRecord(g)) for (const [k, v] of Object.entries(g)) if (MESSAGE_KEY.test(k) && typeof v === 'string') keys.add(k);
    }
    for (const key of keys) states.push({ group, key, kind: 'message', locales: locales.filter((l) => has(l, group, key)) });
  }
  for (const [loc, t] of texts) {
    for (const g of Object.keys(t)) {
      if (g !== JOURNEY_GROUP && !groups.has(g)) warnings.push(`locales/${loc} : groupe ${g} absent de constants.ts`);
    }
  }

  // Textes de chaque état, aplatis (`labels.firstName` → texte).
  const flat = (v: Literal, prefix: string, out: Record<string, string>) => {
    if (typeof v === 'string') out[prefix || 'text'] = v;
    else if (isRecord(v)) for (const [k, x] of Object.entries(v)) flat(x, prefix ? `${prefix}.${k}` : k, out);
  };
  const stateTexts: FrontModel['texts'] = {};
  for (const [loc, t] of texts) {
    const perState: Record<string, Record<string, string>> = {};
    for (const s of states) {
      const g = t[s.group];
      const v = isRecord(g) ? g[s.key] : undefined;
      if (v === undefined) continue;
      const out: Record<string, string> = {};
      flat(v, '', out);
      perState[`${s.group}.${s.key}`] = out;
    }
    stateTexts[loc] = perState;
  }

  return { skeleton: false, groups: [...groups.keys()], states, transitions, locales, emails: parseEmails(emailPaths), texts: stateTexts, warnings };
}

function defaultExportObject(sf: SourceFile): Record<string, Literal> | undefined {
  const exp = sf.getExportAssignment((e) => !e.isExportEquals());
  if (!exp) return undefined;
  let expr: Node = exp.getExpression();
  if (Node.isIdentifier(expr)) {
    const decl = sf.getVariableDeclaration(expr.getText());
    const init = decl?.getInitializer();
    if (!init) return undefined;
    expr = init;
  }
  const v = readLiteral(expr);
  return isRecord(v) ? v : undefined;
}

/**
 * Gabarits d'e-mails (`parseEmails`) d'après l'arborescence :
 * `emails/[<gamme>/]<modèle>/<variante>/<langue>.html`.
 */
export function parseEmails(paths: string[]): EmailTemplate[] {
  const byTemplate = new Map<string, { variants: Map<string, Set<string>>; ranges: Map<string, Map<string, Set<string>>> }>();
  for (const p of paths) {
    const parts = p.split('/').slice(1); // sans « emails »
    const file = parts.at(-1);
    const m = file && /^([a-z]{2}(?:-[A-Z]{2})?)\.html$/.exec(file);
    if (!m || (parts.length !== 3 && parts.length !== 4)) continue;
    const [range, template, variant] = parts.length === 4 ? parts : [undefined, ...parts];
    const entry = byTemplate.get(template!) ?? { variants: new Map(), ranges: new Map() };
    byTemplate.set(template!, entry);
    const target = range ? (entry.ranges.get(range) ?? new Map<string, Set<string>>()) : entry.variants;
    if (range) entry.ranges.set(range, target);
    const locs = target.get(variant!) ?? new Set<string>();
    locs.add(m[1]!);
    target.set(variant!, locs);
  }
  const variantList = (m: Map<string, Set<string>>): EmailVariant[] =>
    [...m.entries()].sort(([a], [b]) => byCodePoint(a, b)).map(([variant, l]) => ({ variant, locales: [...l].sort() }));
  return [...byTemplate.entries()]
    .sort(([a], [b]) => byCodePoint(a, b))
    .map(([template, e]) => {
      const variants = variantList(e.variants);
      const ranges = Object.fromEntries([...e.ranges.entries()].sort(([a], [b]) => byCodePoint(a, b)).map(([r, m]) => [r, variantList(m)]));
      const locales = [...new Set([...variants, ...Object.values(ranges).flat()].flatMap((v) => v.locales))].sort();
      return { template, variants, ranges, locales };
    });
}

/** Tri stable d'une machine à l'autre (pas de dépendance à la locale du système). */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Lit sur disque les fichiers utiles du package (I/O en bordure). */
export function loadFrontPackage(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(root)) throw new Error(`package front introuvable : ${root}`);
  const read = (rel: string) => {
    const abs = join(root, rel);
    if (existsSync(abs)) files[rel] = readFileSync(abs, 'utf8');
  };
  read('scripts/constants.ts');
  for (const dir of ['scripts/steps', 'scripts/locales']) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) if (f.endsWith('.ts')) read(`${dir}/${f}`);
  }
  // Gabarits : seuls les chemins comptent, pas le contenu.
  const walk = (abs: string) => {
    for (const f of readdirSync(abs)) {
      const p = join(abs, f);
      if (statSync(p).isDirectory()) walk(p);
      else files[relative(root, p).split(sep).join('/')] = '';
    }
  };
  if (existsSync(join(root, 'emails'))) walk(join(root, 'emails'));
  return files;
}
