import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  Node,
  Project,
  SyntaxKind,
  type CallExpression,
  type ClassDeclaration,
  type Expression,
  type NewExpression,
  type ParameterDeclaration,
  type SourceFile,
} from 'ts-morph';
import { SDK_CLASS_MARKERS } from './front';

/**
 * Scanner de specs Playwright (§5.3) — HEURISTIQUE. Lit l'AST sans exécuter :
 * suit les appels vers page objets, helpers et configurateurs, évalue ce qui
 * est littéral (gabarits, objets de cas, boucles `for…of`), et laisse `UNKNOWN`
 * tout le reste. Un test n'est jamais réputé atteindre ce que le code ne dit pas.
 */

export interface StepHit {
  step: string;
  match: 'exact' | 'prefix';
  /** Attribut de classe complet (pour les classes SDK accolées). */
  className: string;
}

export interface MarkerHit {
  kind: 'class' | 'id';
  value: string;
}

export interface ScreenshotHit {
  call: string;
  line: number;
  /** Page objet à l'écran au moment de la capture. */
  page: StepHit[];
  /** Suffixe de capture (customSuffix), s'il est connu. */
  suffix: string | null;
  /** Pages utilisées avant la capture, la plus récente d'abord. */
  trail: StepHit[][];
  /** Nom passé à `toHaveScreenshot` (base de l'image de référence), s'il est lisible. */
  name: string | null;
}

export interface EmailCapture {
  subject: string | null;
  suffix: string | null;
  name: string | null;
}

export interface ScannedTest {
  file: string;
  line: number;
  /** Titre complet (describe › test), clé d'index d'un test piloté par données. */
  fullTitle: string;
  title: string;
  describes: string[];
  tags: string[];
  ownTags: string[];
  locales: string[];
  /** Une langue de cas a été vue mais n'a pas pu être lue. */
  localeUnknown: boolean;
  fixtures: string[];
  /** Faux : test API (fixture sans `page`), il n'atteint aucun écran. */
  hasPage: boolean;
  steps: StepHit[];
  markers: MarkerHit[];
  screenshots: ScreenshotHit[];
  emailSubjects: string[];
  emailCaptures: EmailCapture[];
  /** Sessions soumises par le test (paramètre `sessionName`), dans l'ordre : tests workflow. */
  sessions: string[];
  caseValues: Record<string, Value>;
  caseProperties: string[];
  methods: string[];
  configurers: string[];
  /** Assertions : contrôles (ce que le test prouve) et gardes (ce que ses actions attendent). */
  checks: CheckHit[];
  /** Page objets tenus par une variable dans le corps du test (base des gains rapides). */
  pages: PageVar[];
}

export interface PageVar {
  variable: string;
  className: string;
  /** Ligne de la première action sur cette page (là où insérer une capture). */
  firstUseLine: number | null;
  /** Indentation de cette ligne. */
  indent: string;
  steps: StepHit[];
  /** La classe (ou une parente) a une méthode validateUI. */
  hasValidate: boolean;
  /** Le test capture déjà cette page (validateUI ou autre capture sur la variable). */
  captured: boolean;
}

export type CheckStrength = 'valeur' | 'presence' | 'visuel';

export interface CheckHit {
  /** `Classe.méthode` ou `fonction` de contrôle, ou `expect.<matcher>` pour une assertion directe. */
  check: string;
  kind: 'control' | 'guard';
  strength: CheckStrength;
  line: number;
  /** Fonction ou méthode qui contient l'assertion (null = corps du test). */
  owner: string | null;
}

/** Fonctions / méthodes dont le nom dit « je vérifie » : leurs assertions sont des contrôles. */
export const CHECK_NAME = /^(check|assert|verify|validate|expect[A-Z])/;
const VISUAL_MATCHERS = new Set(['toHaveScreenshot', 'toMatchSnapshot']);
const PRESENCE_MATCHERS = new Set(['toBeVisible', 'toBeHidden', 'toBeAttached', 'toBeDefined', 'toBeUndefined', 'toBeTruthy', 'toBeFalsy', 'toBeNull', 'toHaveCount', 'toBeEnabled', 'toBeDisabled', 'toBeChecked', 'toBeOK', 'toBeEmpty']);
const STRENGTH_RANK: Record<CheckStrength, number> = { presence: 0, visuel: 1, valeur: 2 };
const matcherStrength = (m: string): CheckStrength => (VISUAL_MATCHERS.has(m) ? 'visuel' : PRESENCE_MATCHERS.has(m) ? 'presence' : 'valeur');

export interface ScanResult {
  tests: ScannedTest[];
  files: string[];
  /** Fichiers (absolus) que la marche a réellement lus : specs, page objets, helpers… */
  readFiles: string[];
  warnings: string[];
}

// ——— valeurs ———

export const UNKNOWN = '<unknown>' as const;
export type Value = string | number | boolean | null | undefined | typeof UNKNOWN | Value[] | { [k: string]: Value };

const isRecord = (v: Value): v is { [k: string]: Value } => typeof v === 'object' && v !== null && !Array.isArray(v);
const known = (v: Value): boolean =>
  v !== UNKNOWN && (Array.isArray(v) ? v.every(known) : isRecord(v) ? Object.values(v).every(known) : true);

/** Méthodes « sonde » : les appeler ne prouve pas qu'un écran est atteint. */
export const PROBES = new Set(['isVisible', 'isHidden', 'count', 'isEnabled', 'isChecked']);
/** Appels de capture : validation visuelle + textuelle de l'écran. */
export const SCREENSHOT_CALLS = new Set(['toHaveScreenshot', 'checkUI', 'checkPageScreenshot', 'validateEmailUI', 'validateUI']);
const CONFIGURER = /^configure\w*$/;
const MAX_DEPTH = 15;

interface Scope {
  vars: Map<string, Value>;
  thisClass?: ClassDeclaration;
}

interface Acc {
  steps: StepHit[];
  markers: MarkerHit[];
  screenshots: ScreenshotHit[];
  /** Pages utilisées, dans l'ordre. */
  trail: StepHit[][];
  emailSubjects: string[];
  emailCaptures: EmailCapture[];
  sessions: string[];
  caseValues: Record<string, Value>;
  locales: Set<string>;
  localeUnknown: boolean;
  methods: Set<string>;
  configurers: Set<string>;
  lastSubject: string | null;
  checks: CheckHit[];
  /** Fonctions du projet en cours de marche ; `check` = entrée de contrôle si c'est une fonction de contrôle. */
  owners: { name: string; check: CheckHit | null }[];
  stack: string[];
}

// ——— extraction des localisateurs ———

const SDK_CLASSES = new Set(Object.keys(SDK_CLASS_MARKERS));

export function extractHits(text: string): { steps: StepHit[]; markers: MarkerHit[] } {
  const steps: StepHit[] = [];
  const markers: MarkerHit[] = [];
  for (const m of text.matchAll(/contains\(\s*@class\s*,\s*['"]step-([^'"]+)['"]\s*\)/g)) {
    steps.push({ step: m[1]!, match: 'prefix', className: `step-${m[1]}` });
  }
  for (const m of text.matchAll(/@class\s*=\s*['"]([^'"]+)['"]/g)) {
    const classes = m[1]!.trim().split(/\s+/);
    for (const c of classes) {
      if (c.startsWith('step-')) steps.push({ step: c.slice(5), match: 'exact', className: m[1]!.trim() });
      else if (SDK_CLASSES.has(c)) markers.push({ kind: 'class', value: c });
    }
  }
  for (const m of text.matchAll(/\[class\*=['"]?step-([\w-]+)['"]?\]/g)) {
    steps.push({ step: m[1]!, match: 'prefix', className: `step-${m[1]}` });
  }
  // Sélecteurs CSS : .step-x, .classe-sdk, #id (hors XPath déjà lu).
  const css = text.replace(/\/\/[^\s]*\[[^\]]*\]/g, ' ');
  for (const m of css.matchAll(/(?:^|[\s>+~,(])\.((?:step-)?[A-Za-z][\w-]*)/g)) {
    const c = m[1]!;
    if (c.startsWith('step-')) steps.push({ step: c.slice(5), match: 'exact', className: c });
    else if (SDK_CLASSES.has(c)) markers.push({ kind: 'class', value: c });
  }
  for (const m of css.matchAll(/(?:^|[\s>+~,(])#([A-Za-z][\w-]*)/g)) markers.push({ kind: 'id', value: m[1]! });
  for (const m of text.matchAll(/@id\s*=\s*['"]([^'"]+)['"]/g)) markers.push({ kind: 'id', value: m[1]! });
  return { steps, markers };
}

// ——— scanner ———

export function scanTests(root: string, specs: string[]): ScanResult {
  const warnings: string[] = [];
  const project = new Project({
    compilerOptions: { target: 9 /* ES2022 */, module: 99 /* ESNext */, moduleResolution: 100 /* Bundler */, strict: false, noEmit: true, skipLibCheck: true },
    skipAddingFilesFromTsConfig: true,
  });
  for (const f of listTs(root)) project.addSourceFileAtPath(f);

  const specFiles = new Set<string>();
  for (const s of specs) {
    const abs = join(root, s);
    if (!existsSync(abs)) {
      warnings.push(`spec introuvable : ${s}`);
      continue;
    }
    if (statSync(abs).isDirectory()) listTs(abs).filter((f) => f.endsWith('.spec.ts')).forEach((f) => specFiles.add(f));
    else specFiles.add(abs);
  }

  const rel = (p: string) => relative(root, p).split(sep).join('/');
  const inProject = (n: Node) => !n.getSourceFile().getFilePath().includes('/node_modules/') && n.getSourceFile().getFilePath().startsWith(root);

  const readFiles = new Set<string>();
  const touch = (n: Node) => readFiles.add(n.getSourceFile().getFilePath());

  const tests: ScannedTest[] = [];
  const files = [...specFiles].sort();
  files.forEach((f) => readFiles.add(f));
  for (const file of files) {
    const sf = project.getSourceFileOrThrow(file);
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (!isTestCall(call)) continue;
      for (const bindings of loopBindings(call)) tests.push(scanOne(sf, call, bindings));
    }
  }
  return { tests, files: files.map(rel), readFiles: [...readFiles].sort(), warnings };

  // ——— un test (une entrée par jeu de données) ———

  function scanOne(sf: SourceFile, call: CallExpression, vars: Map<string, Value>): ScannedTest {
    const scope: Scope = { vars: new Map(vars) };
    const args = call.getArguments();
    const title = asText(evalExpr(args[0] as Expression, scope), args[0]!.getText());
    const describes: string[] = [];
    const tags: string[] = [];
    for (const d of call.getAncestors().filter((a): a is CallExpression => Node.isCallExpression(a) && isDescribeCall(a)).reverse()) {
      const dArgs = d.getArguments();
      const dt = asText(evalExpr(dArgs[0] as Expression, scope), dArgs[0]?.getText() ?? '');
      describes.push(dt);
      tags.push(...tagsIn(dt), ...optionTags(dArgs.slice(1), scope));
    }
    const ownTags = [...tagsIn(title), ...optionTags(args.slice(1, -1), scope)];

    const fn = args.at(-1);
    const fixtures: string[] = [];
    const pages: PageVar[] = [];
    const acc: Acc = {
      steps: [], markers: [], screenshots: [], trail: [], emailSubjects: [], emailCaptures: [],
      sessions: [], caseValues: {}, locales: new Set(), localeUnknown: false, methods: new Set(), configurers: new Set(),
      lastSubject: null, stack: [], checks: [], owners: [],
    };
    if (fn && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) {
      const p = fn.getParameters()[0];
      const pattern = p?.getNameNode();
      if (pattern && Node.isObjectBindingPattern(pattern)) {
        for (const el of pattern.getElements()) fixtures.push(el.getPropertyNameNode()?.getText() ?? el.getName());
      }
      walk(fn.getBody(), scope, acc, null, 0, false);
      pages.push(...pageVars(fn.getBody(), scope));
    }

    return {
      file: rel(sf.getFilePath()),
      line: call.getStartLineNumber(),
      fullTitle: [...describes, title].join(' › '),
      title,
      describes,
      tags: uniq(tags),
      ownTags: uniq(ownTags),
      locales: [...acc.locales].sort(),
      localeUnknown: acc.localeUnknown,
      fixtures,
      hasPage: fixtures.includes('page'),
      steps: uniqBy(acc.steps, (s) => `${s.match}|${s.step}|${s.className}`),
      markers: uniqBy(acc.markers, (m) => `${m.kind}|${m.value}`),
      screenshots: acc.screenshots,
      emailSubjects: uniq(acc.emailSubjects),
      sessions: acc.sessions,
      emailCaptures: acc.emailCaptures,
      caseValues: acc.caseValues,
      caseProperties: Object.keys(acc.caseValues).sort(),
      methods: [...acc.methods].sort(),
      configurers: [...acc.configurers].sort(),
      checks: acc.checks,
      pages,
    };
  }

  // ——— marche ———

  /**
   * Parcourt un corps de fonction dans l'ordre du source. `group` reçoit les
   * localisateurs vus dans une méthode de page objet (page utilisée).
   */
  function walk(node: Node | undefined, scope: Scope, acc: Acc, group: StepHit[] | null, depth: number, inShot: boolean): void {
    if (!node) return;
    if (Node.isCallExpression(node)) {
      node.getArguments().forEach((a) => walk(a, scope, acc, group, depth, inShot));
      walk(node.getExpression(), scope, acc, group, depth, inShot);
      handleCall(node, scope, acc, group, depth, inShot);
      return;
    }
    if (Node.isNewExpression(node)) {
      node.getArguments().forEach((a) => walk(a, scope, acc, group, depth, inShot));
      handleNew(node, scope, acc);
      return;
    }
    if (Node.isVariableDeclaration(node)) {
      walk(node.getInitializer(), scope, acc, group, depth, inShot);
      const name = node.getNameNode();
      if (Node.isIdentifier(name)) scope.vars.set(name.getText(), evalExpr(node.getInitializer(), scope));
      return;
    }
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) || Node.isTemplateExpression(node)) {
      if (isProbed(node)) return;
      collectStrings(node, scope, acc, group);
      return;
    }
    // Accès à un getter / une propriété de page objet : déjà compté dans la page.
    node.forEachChild((c) => walk(c, scope, acc, group, depth, inShot));
  }

  function collectStrings(node: Node, scope: Scope, acc: Acc, group: StepHit[] | null): void {
    const v = evalExpr(node as Expression, scope);
    if (typeof v !== 'string') {
      if (/step-/.test(node.getText())) {
        warnings.push(`${rel(node.getSourceFile().getFilePath())}:${node.getStartLineNumber()} : classe d'étape calculée illisible ${node.getText()}`);
      }
      return;
    }
    const { steps, markers } = extractHits(v);
    acc.steps.push(...steps);
    acc.markers.push(...markers);
    group?.push(...steps);
  }

  function handleCall(call: CallExpression, scope: Scope, acc: Acc, group: StepHit[] | null, depth: number, inShot: boolean): void {
    const callee = call.getExpression();
    const name = Node.isPropertyAccessExpression(callee) ? callee.getName() : Node.isIdentifier(callee) ? callee.getText() : undefined;
    if (!name || PROBES.has(name)) return;
    if (recordExpect(call, name, acc)) return;

    const receiver = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
    const cls = receiver ? classOf(receiver, scope) : undefined;
    const decl = cls ? findMethod(cls, name) : functionDecl(callee);
    const params = decl ? decl.getParameters() : [];
    const argValues = call.getArguments().map((a) => evalExpr(a as Expression, scope));

    if (SCREENSHOT_CALLS.has(name)) {
      if (inShot) return;
      const shownClass = cls ?? scope.thisClass;
      const page = shownClass ? pageOf(shownClass) : [];
      const suffix = suffixOf(call, params, argValues);
      const shot = shotName(call, name, decl, params, argValues, cls ?? scope.thisClass, scope, acc, 0);
      acc.steps.push(...page);
      acc.screenshots.push({ call: name, line: call.getStartLineNumber(), page, suffix, trail: trailBefore(acc.trail, page), name: shot });
      if (name === 'validateEmailUI') acc.emailCaptures.push({ subject: acc.lastSubject, suffix, name: shot });
      if (cls) acc.methods.add(`${cls.getName()}.${name}`);
      if (name !== 'toHaveScreenshot') recordCheck(cls ? `${cls.getName()}.${name}` : name, 'visuel', call, acc); // sinon déjà compté par recordExpect
      return;
    }
    if (!decl || !inProject(decl) || depth >= MAX_DEPTH) return;
    touch(decl);

    const key = `${decl.getSourceFile().getFilePath()}:${decl.getStart()}|${cls?.getName() ?? ''}|${JSON.stringify(argValues)}`;
    if (acc.stack.includes(key)) return;

    const inner: Scope = { vars: bindParams(params, argValues, acc), ...(cls ? { thisClass: cls } : {}) };
    if (!cls && CONFIGURER.test(name)) recordCase(name, params, argValues, inner, acc);

    let pageGroup = group;
    if (cls && !isProbeMethod(decl)) {
      acc.methods.add(`${cls.getName()}.${name}`);
      const page = pageOf(cls);
      acc.steps.push(...page);
      pageGroup = [...page];
      acc.trail.push(pageGroup);
    }
    const owner = cls ? `${cls.getName()}.${name}` : name;
    const check = CHECK_NAME.test(name) ? recordCheck(owner, 'presence', call, acc, true) : null;
    acc.owners.push({ name: owner, check });
    acc.stack.push(key);
    walk(decl.getBody(), inner, acc, pageGroup, depth + 1, inShot);
    acc.stack.pop();
    acc.owners.pop();
  }

  /**
   * Nom de l'image : 1er argument de `toHaveScreenshot`, évalué dans la méthode
   * de capture (paramètres liés, `this` = page objet) si c'est une méthode du projet.
   */
  function shotName(
    call: CallExpression,
    name: string,
    decl: ReturnType<typeof findMethod> | ReturnType<typeof functionDecl>,
    params: ParameterDeclaration[],
    args: Value[],
    thisClass: ClassDeclaration | undefined,
    scope: Scope,
    acc: Acc,
    depth: number,
  ): string | null {
    const asName = (v: Value): string | null => (typeof v === 'string' && v !== UNKNOWN ? v : Array.isArray(v) && v.every((x) => typeof x === 'string' && x !== UNKNOWN) ? v.join('/') : null);
    if (name === 'toHaveScreenshot') {
      const a = call.getArguments()[0];
      return a && !Node.isObjectLiteralExpression(a) ? asName(evalExpr(a, scope)) : null;
    }
    if (!decl || !inProject(decl) || depth > 4) return null;
    const inner: Scope = { vars: bindParams(params, args, { ...acc, emailSubjects: [], sessions: [], lastSubject: acc.lastSubject }), ...(thisClass ? { thisClass } : {}) };
    for (const c of decl.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = c.getExpression();
      const n = Node.isPropertyAccessExpression(callee) ? callee.getName() : Node.isIdentifier(callee) ? callee.getText() : '';
      if (!SCREENSHOT_CALLS.has(n)) continue;
      const recv = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : undefined;
      const innerCls = recv ? classOf(recv, inner) : undefined;
      const innerDecl = innerCls ? findMethod(innerCls, n) : functionDecl(callee);
      const innerArgs = c.getArguments().map((x) => evalExpr(x as Expression, inner));
      return shotName(c, n, innerDecl, innerDecl?.getParameters() ?? [], innerArgs, innerCls ?? thisClass, inner, acc, depth + 1);
    }
    return null;
  }

  /** Variables `const x = new PageObjet(…)` du corps du test, et où elles servent d'abord. */
  function pageVars(body: Node | undefined, scope: Scope): PageVar[] {
    if (!body || !Node.isBlock(body)) return [];
    const stmts = body.getStatements();
    const out: PageVar[] = [];
    stmts.forEach((st, i) => {
      if (!Node.isVariableStatement(st)) return;
      for (const d of st.getDeclarations()) {
        let init: Node | undefined = d.getInitializer();
        if (init && Node.isAwaitExpression(init)) init = init.getExpression();
        if (!init || !Node.isNewExpression(init) || !Node.isIdentifier(d.getNameNode())) continue;
        const cls = classOf(init, scope);
        if (!cls) continue;
        const name = d.getName();
        const uses = new RegExp(`\\b${name}\\.(\\w+)\\s*\\(`, 'g');
        let first: Node | null = null;
        let captured = false;
        for (const later of stmts.slice(i + 1)) {
          for (const m of later.getText().matchAll(uses)) {
            if (SCREENSHOT_CALLS.has(m[1]!)) captured = true;
            else if (!PROBES.has(m[1]!) && !first) first = later;
          }
        }
        const line = first?.getStartLineNumber() ?? null;
        const text = first ? first.getSourceFile().getFullText().split('\n')[line! - 1] ?? '' : '';
        out.push({
          variable: name,
          className: cls.getName() ?? '?',
          firstUseLine: line,
          indent: /^\s*/.exec(text)?.[0] ?? '',
          steps: pageOf(cls),
          hasValidate: !!findMethod(cls, 'validateUI'),
          captured,
        });
      }
    });
    return out;
  }

  /**
   * Un contrôle est hors de toute action : dans le corps du test ou dans des
   * fonctions de contrôle seulement. Sinon c'est une garde de l'action.
   */
  function recordCheck(check: string, strength: CheckStrength, call: CallExpression, acc: Acc, isOwner = false): CheckHit | null {
    const enclosing = [...acc.owners].reverse().find((o) => o.check);
    const inAction = acc.owners.some((o) => !o.check);
    if (enclosing && !inAction && !isOwner) {
      // Assertion interne d'une fonction de contrôle : elle donne sa force au contrôle.
      if (STRENGTH_RANK[strength] > STRENGTH_RANK[enclosing.check!.strength]) enclosing.check!.strength = strength;
      return null;
    }
    if (enclosing && !inAction && isOwner) return enclosing.check; // contrôle appelé depuis un contrôle : un seul
    const hit: CheckHit = {
      check,
      kind: inAction ? 'guard' : 'control',
      strength,
      line: call.getStartLineNumber(),
      owner: acc.owners.at(-1)?.name ?? null,
    };
    acc.checks.push(hit);
    return hit;
  }

  /** `expect(x)[.not|.resolves…].matcher(…)`, `expect.soft`, `expect.poll` : une assertion directe. */
  function recordExpect(call: CallExpression, name: string, acc: Acc): boolean {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || !name.startsWith('to')) return false;
    let base: Node = callee.getExpression();
    while (Node.isPropertyAccessExpression(base) && ['not', 'resolves', 'rejects'].includes(base.getName())) base = base.getExpression();
    if (!Node.isCallExpression(base)) return false;
    const root = base.getExpression().getText();
    if (!/^expect(\.(soft|poll))?$/.test(root)) return false;
    recordCheck(`expect.${name}`, matcherStrength(name), call, acc);
    return name !== 'toHaveScreenshot'; // une capture continue d'être traitée comme capture
  }

  function handleNew(expr: NewExpression, scope: Scope, acc: Acc): void {
    const cls = classOf(expr, scope);
    if (!cls) return;
    chain(cls).forEach(touch);
    const ctor = chain(cls).flatMap((c) => c.getConstructors())[0];
    if (ctor) bindParams(ctor.getParameters(), expr.getArguments().map((a) => evalExpr(a as Expression, scope)), acc);
  }

  /** Lie les paramètres ; un paramètre `subject` connu est un objet d'e-mail cherché. */
  function bindParams(params: ParameterDeclaration[], args: Value[], acc: Acc): Map<string, Value> {
    const vars = new Map<string, Value>();
    params.forEach((p, i) => {
      const defaultValue = (): Value => evalExpr(p.getInitializer(), { vars });
      const arg = args[i] !== undefined ? args[i] : p.getInitializer() ? defaultValue() : undefined;
      const nameNode = p.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        vars.set(nameNode.getText(), arg);
        if (nameNode.getText() === 'subject' && typeof arg === 'string') {
          acc.emailSubjects.push(arg);
          acc.lastSubject = arg;
        }
        if (nameNode.getText() === 'sessionName' && typeof arg === 'string' && arg !== UNKNOWN) acc.sessions.push(arg);
      } else if (Node.isObjectBindingPattern(nameNode)) {
        const rec = isRecord(arg) ? arg : {};
        const used = new Set<string>();
        for (const el of nameNode.getElements()) {
          if (el.getDotDotDotToken()) {
            vars.set(el.getName(), Object.fromEntries(Object.entries(rec).filter(([k]) => !used.has(k))));
            continue;
          }
          const prop = el.getPropertyNameNode()?.getText() ?? el.getName();
          used.add(prop);
          const v = arg === UNKNOWN ? UNKNOWN : rec[prop] !== undefined ? rec[prop] : evalExpr(el.getInitializer(), { vars });
          vars.set(el.getName(), v);
        }
      }
    });
    return vars;
  }

  /** Valeurs du cas créé par un configurateur, et sa langue. */
  function recordCase(name: string, params: ParameterDeclaration[], args: Value[], inner: Scope, acc: Acc): void {
    acc.configurers.add(name);
    const values: Record<string, Value> = {};
    params.forEach((p, i) => {
      const n = p.getNameNode();
      if (Node.isObjectBindingPattern(n)) {
        for (const el of n.getElements()) {
          const v = inner.vars.get(el.getName());
          if (el.getDotDotDotToken() && isRecord(v)) Object.assign(values, v);
          else if (!el.getDotDotDotToken()) values[el.getPropertyNameNode()?.getText() ?? el.getName()] = v;
        }
      } else if (isRecord(args[i])) Object.assign(values, args[i]);
    });
    Object.assign(acc.caseValues, values);
    if (!('locale' in values)) return;
    const locale = values.locale;
    if (typeof locale === 'string' && locale !== UNKNOWN) acc.locales.add(locale);
    else acc.localeUnknown = true;
  }

  function suffixOf(call: CallExpression, params: ParameterDeclaration[], args: Value[]): string | null {
    for (const a of args) if (isRecord(a) && typeof a.customSuffix === 'string') return a.customSuffix;
    const i = params.findIndex((p) => p.getName() === 'customSuffix');
    const v = i >= 0 ? args[i] : undefined;
    void call;
    return typeof v === 'string' ? v : null;
  }

  // ——— classes et fonctions ———

  function classOf(expr: Expression, scope: Scope): ClassDeclaration | undefined {
    if (Node.isThisExpression(expr)) return scope.thisClass;
    const type = expr.getType();
    const decl = (type.getSymbol() ?? type.getAliasSymbol())?.getDeclarations().find(Node.isClassDeclaration);
    return decl && inProject(decl) ? decl : undefined;
  }

  function findMethod(cls: ClassDeclaration, name: string) {
    for (const c of chain(cls)) {
      const m = c.getInstanceMethod(name);
      if (m) return m;
    }
    return undefined;
  }

  function functionDecl(callee: Expression) {
    let sym = callee.getSymbol();
    if (sym?.isAlias()) sym = sym.getAliasedSymbol() ?? sym;
    for (const d of sym?.getDeclarations() ?? []) {
      if (Node.isFunctionDeclaration(d)) return d;
      if (Node.isVariableDeclaration(d)) {
        const init = d.getInitializer();
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return init;
      }
    }
    return undefined;
  }

  /** Localisateurs de la page objet : propriétés, getters et constructeurs (le plus dérivé l'emporte). */
  function pageOf(cls: ClassDeclaration): StepHit[] {
    const hits: StepHit[] = [];
    const seen = new Set<string>();
    const scope: Scope = { vars: new Map(), thisClass: cls };
    const take = (n: Node | undefined) => {
      if (!n) return;
      const strings = [n, ...n.getDescendants()].filter((d) => Node.isStringLiteral(d) || Node.isNoSubstitutionTemplateLiteral(d) || Node.isTemplateExpression(d));
      for (const s of strings) {
        if (s.getParent() && Node.isTemplateSpan(s.getParent()!)) continue;
        const v = evalExpr(s as Expression, scope);
        if (typeof v === 'string') hits.push(...extractHits(v).steps);
      }
    };
    for (const c of chain(cls)) {
      touch(c);
      for (const p of c.getInstanceProperties()) {
        const name = p.getName();
        if (seen.has(name)) continue;
        seen.add(name);
        if (Node.isPropertyDeclaration(p)) take(p.getInitializer());
        else if (Node.isGetAccessorDeclaration(p)) take(p.getBody());
      }
      for (const ctor of c.getConstructors()) take(ctor.getBody());
    }
    return uniqBy(hits, (h) => `${h.match}|${h.step}|${h.className}`);
  }

  function chain(cls: ClassDeclaration): ClassDeclaration[] {
    const out: ClassDeclaration[] = [];
    for (let c: ClassDeclaration | undefined = cls; c && !out.includes(c); c = c.getBaseClass()) out.push(c);
    return out;
  }

  /** Méthode dont toutes les instructions finissent par une sonde. */
  function isProbeMethod(decl: Node): boolean {
    const body = (decl as { getBody?: () => Node | undefined }).getBody?.();
    if (!body || !Node.isBlock(body)) return false;
    const finals = body.getStatements().map((s) => {
      let e: Node | undefined = Node.isExpressionStatement(s) ? s.getExpression() : Node.isReturnStatement(s) ? s.getExpression() : undefined;
      if (e && Node.isAwaitExpression(e)) e = e.getExpression();
      if (!e || !Node.isCallExpression(e)) return undefined;
      const c = e.getExpression();
      return Node.isPropertyAccessExpression(c) ? c.getName() : c.getText();
    });
    return finals.length > 0 && finals.every((n) => n !== undefined && PROBES.has(n));
  }

  /** La chaîne fait partie du receveur d'une sonde (`page.locator(x).isVisible()`). */
  function isProbed(node: Node): boolean {
    for (let cur: Node | undefined = node; cur && !Node.isStatement(cur); cur = cur.getParent()) {
      const parent = cur.getParent();
      if (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === cur && PROBES.has(parent.getName())) return true;
    }
    return false;
  }

  // ——— évaluateur ———

  function evalExpr(node: Node | undefined, scope: Scope, depth = 0): Value {
    if (!node || depth > 20) return node ? UNKNOWN : undefined;
    const ev = (n: Node | undefined) => evalExpr(n, scope, depth + 1);
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
    if (Node.isNumericLiteral(node)) return node.getLiteralValue();
    if (node.getKind() === SyntaxKind.TrueKeyword) return true;
    if (node.getKind() === SyntaxKind.FalseKeyword) return false;
    if (node.getKind() === SyntaxKind.NullKeyword) return null;
    if (Node.isTemplateExpression(node)) {
      let s = node.getHead().getLiteralText();
      for (const span of node.getTemplateSpans()) {
        const v = ev(span.getExpression());
        if (v === UNKNOWN || (typeof v === 'object' && v !== null)) return UNKNOWN;
        s += String(v ?? '') + span.getLiteral().getLiteralText();
      }
      return s;
    }
    if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isParenthesizedExpression(node) || Node.isAwaitExpression(node) || Node.isNonNullExpression(node)) {
      return ev(node.getExpression());
    }
    if (Node.isIdentifier(node)) {
      const name = node.getText();
      if (name === 'undefined') return undefined;
      if (scope.vars.has(name)) return scope.vars.get(name);
      return constValue(node, depth);
    }
    if (Node.isPropertyAccessExpression(node)) {
      const obj = node.getExpression();
      if (Node.isThisExpression(obj)) return scope.thisClass ? thisProp(scope.thisClass, node.getName(), depth) : UNKNOWN;
      const v = ev(obj);
      return isRecord(v) ? v[node.getName()] : UNKNOWN;
    }
    if (Node.isObjectLiteralExpression(node)) {
      const out: Record<string, Value> = {};
      for (const p of node.getProperties()) {
        if (Node.isPropertyAssignment(p)) out[p.getName().replace(/^['"]|['"]$/g, '')] = ev(p.getInitializer());
        else if (Node.isShorthandPropertyAssignment(p)) out[p.getName()] = ev(p.getNameNode());
        else if (Node.isSpreadAssignment(p)) {
          const v = ev(p.getExpression());
          if (isRecord(v)) Object.assign(out, v);
          else return UNKNOWN;
        } else return UNKNOWN;
      }
      return out;
    }
    if (Node.isArrayLiteralExpression(node)) return node.getElements().map(ev);
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getKind();
      const l = ev(node.getLeft());
      const r = ev(node.getRight());
      if (op === SyntaxKind.PlusToken && (typeof l === 'string' || typeof l === 'number') && (typeof r === 'string' || typeof r === 'number')) {
        return (l as string) + (r as string);
      }
      if (op === SyntaxKind.QuestionQuestionToken && l !== UNKNOWN) return l ?? r;
      return UNKNOWN;
    }
    if (Node.isConditionalExpression(node)) {
      const c = ev(node.getCondition());
      if (c === UNKNOWN || (typeof c === 'object' && c !== null)) return UNKNOWN;
      return c ? ev(node.getWhenTrue()) : ev(node.getWhenFalse());
    }
    return UNKNOWN;
  }

  /** Constante `const X = …` résolue à travers les imports. */
  function constValue(id: Node, depth: number): Value {
    let sym = id.getSymbol();
    if (sym?.isAlias()) sym = sym.getAliasedSymbol() ?? sym;
    const decl = sym?.getDeclarations().find(Node.isVariableDeclaration);
    if (!decl || !inProject(decl)) return UNKNOWN;
    touch(decl);
    const list = decl.getVariableStatement();
    if (!list || list.getDeclarationKind() !== 'const') return UNKNOWN;
    return evalExpr(decl.getInitializer(), { vars: new Map() }, depth + 1);
  }

  /** `this.x` : initialiseur de propriété, du plus dérivé au plus général. */
  function thisProp(cls: ClassDeclaration, name: string, depth: number): Value {
    for (const c of chain(cls)) {
      const p = c.getInstanceProperty(name);
      if (p && Node.isPropertyDeclaration(p) && p.getInitializer()) return evalExpr(p.getInitializer(), { vars: new Map(), thisClass: cls }, depth + 1);
      if (p) return UNKNOWN;
    }
    return UNKNOWN;
  }

  // ——— découverte des tests ———

  /** Jeux de liaisons des boucles `for…of` englobantes (une entrée par donnée). */
  function loopBindings(call: CallExpression): Map<string, Value>[] {
    const loops = call.getAncestors().filter(Node.isForOfStatement).reverse();
    let sets: Map<string, Value>[] = [new Map()];
    for (const loop of loops) {
      const init = loop.getInitializer();
      const decl = Node.isVariableDeclarationList(init) ? init.getDeclarations()[0] : undefined;
      const name = decl?.getNameNode();
      if (!name || !Node.isIdentifier(name)) continue;
      sets = sets.flatMap((vars) => {
        const items = evalExpr(loop.getExpression(), { vars });
        if (!Array.isArray(items) || !items.every(known)) {
          warnings.push(`${rel(loop.getSourceFile().getFilePath())}:${loop.getStartLineNumber()} : boucle de données illisible`);
          return [new Map([...vars, [name.getText(), UNKNOWN as Value]])];
        }
        return items.map((v) => new Map([...vars, [name.getText(), v]]));
      });
    }
    return sets;
  }

  function optionTags(args: Node[], scope: Scope): string[] {
    const out: string[] = [];
    for (const a of args) {
      const v = evalExpr(a, scope);
      if (!isRecord(v)) continue;
      const t = v.tag;
      for (const x of Array.isArray(t) ? t : [t]) if (typeof x === 'string') out.push(x);
    }
    return out;
  }
}

// ——— utilitaires ———

const groupKey = (g: StepHit[]): string => g.map((h) => `${h.match}|${h.step}`).sort().join(',');

/**
 * Pages utilisées avant une capture, la plus récente d'abord : sans la page
 * capturée elle-même en tête, sans répétitions consécutives, sans groupe vide.
 */
export function trailBefore(trail: StepHit[][], page: StepHit[]): StepHit[][] {
  const out: StepHit[][] = [];
  const pageKey = groupKey(page);
  let leading = true;
  for (const g of [...trail].reverse()) {
    const k = groupKey(g);
    if (!g.length) continue;
    if (leading && k === pageKey) continue;
    leading = false;
    if (out.length && groupKey(out.at(-1)!) === k) continue;
    out.push(g);
  }
  return out;
}

const TEST_MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail', 'slow']);

function isTestCall(call: CallExpression): boolean {
  const e = call.getExpression();
  const args = call.getArguments();
  if (args.length < 2) return false;
  const last = args.at(-1)!;
  if (!Node.isArrowFunction(last) && !Node.isFunctionExpression(last)) return false;
  if (Node.isIdentifier(e)) return e.getText() === 'test' || e.getText() === 'it';
  return Node.isPropertyAccessExpression(e) && e.getExpression().getText() === 'test' && TEST_MODIFIERS.has(e.getName());
}

function isDescribeCall(call: CallExpression): boolean {
  const t = call.getExpression().getText();
  return /^(test\.)?describe(\.(only|skip|serial|parallel|fixme))*$/.test(t);
}

const tagsIn = (s: string): string[] => [...s.matchAll(/@[\w-]+/g)].map((m) => m[0]);
const asText = (v: Value, fallback: string): string => (typeof v === 'string' ? v : fallback);
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
function uniqBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f.startsWith('.')) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (f.endsWith('.ts') && !f.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
