import type { CaptureRef, Cell, EmailCoverage, ExcludedItem, TestRef, UnattributedEmail } from '../../core/coverage';
import type { JourneyConfig } from '../../core/journey';
import type { BpmnEmail, BpmnModel } from '../parsers/bpmn';
import type { FrontModel } from '../parsers/front';
import type { ScannedTest, Value } from '../parsers/scanTests';
import { testRef } from './tests';

/**
 * Couverture des e-mails (§6) : gabarit × variante × langue. Un test atteint
 * un e-mail en le cherchant par objet, le couvre en le capturant.
 */

/** Objet normalisé : apostrophes typographiques, `…`, espaces, ponctuation finale, casse. */
export function normalizeSubject(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[’‘ʼ`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/…|\.{3}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.!?:;,]+$/, '')
    .toLowerCase();
}

export interface EmailsResult {
  emails: EmailCoverage[];
  orphanTemplates: string[];
  unattributed: UnattributedEmail[];
  excluded: ExcludedItem[];
  warnings: string[];
}

interface Target {
  template: string;
  first: BpmnEmail;
  variants: string[];
  /** Gammes présentes parmi les variantes (`<gamme>/<variante>`). */
  ranges: string[];
  /** Variables de la règle de dossier (choix de la gamme). */
  rangeVariables: string[];
  locales: string[];
  fixedLocale?: string;
  missingTemplate: boolean;
}

const lower = (v: Value): string | null => (typeof v === 'string' ? v.toLowerCase() : null);

/** Variante atteinte par un test, ou null si le code ne permet pas de trancher. */
export function variantFor(target: Target, test: ScannedTest, suffix: string | null, config: Pick<JourneyConfig, 'emailCaptureVariants'>): string | null {
  const vs = target.variants;
  if (vs.length === 1) return vs[0]!;
  const bySuffix = suffix ? config.emailCaptureVariants?.[suffix] : undefined;
  if (bySuffix && vs.includes(bySuffix)) return bySuffix;

  // Gamme : la variable de la règle de dossier vaut-elle une gamme connue ?
  const range = target.rangeVariables.map((v) => test.caseValues[v]).find((v): v is string => typeof v === 'string' && target.ranges.includes(v));
  const pool = range ? vs.filter((v) => v.startsWith(`${range}/`)) : vs.filter((v) => !v.includes('/'));
  if (pool.length === 1) return pool[0]!;

  const leaf = (v: string) => v.slice(v.lastIndexOf('/') + 1).toLowerCase();
  const clues = [suffix?.toLowerCase() ?? null, ...Object.values(test.caseValues).map(lower)].filter((x): x is string => !!x);
  const matched = pool.filter((v) => clues.includes(leaf(v)));
  return matched.length === 1 ? matched[0]! : null;
}

export function computeEmails(
  bpmn: BpmnModel,
  front: FrontModel,
  config: JourneyConfig,
  perTest: { test: ScannedTest; locales: string[] }[],
): EmailsResult {
  const excluded: ExcludedItem[] = [];
  const warnings: string[] = [];
  const excludedTriggers = new Set(config.excludedEmailTriggers);
  const excludedTemplates = new Set(config.excludedEmailTemplates ?? []);
  const frontTemplates = new Map(front.emails.map((e) => [e.template, e]));

  const targets = new Map<string, Target>();
  const sentTemplates = new Set<string>();
  for (const e of bpmn.emails) {
    if (!e.template) {
      warnings.push(`e-mail ${e.taskId} : modèle non évaluable`);
      continue;
    }
    sentTemplates.add(e.template);
    if (excludedTriggers.has(e.trigger)) {
      excluded.push({ id: `email:${e.template}`, reason: `déclencheur ${e.trigger} hors périmètre (config)` });
      continue;
    }
    if (excludedTemplates.has(e.template)) {
      excluded.push({ id: `email:${e.template}`, reason: 'gabarit hors périmètre (config)' });
      continue;
    }
    const existing = targets.get(e.template);
    if (existing) continue; // même gabarit envoyé ailleurs : une seule cible
    const ft = frontTemplates.get(e.template);
    const rule = e.folderRules[0];
    const allowedRanges = rule?.folders ? rule.folders.filter((f): f is string => typeof f === 'string') : null;
    const rangeEntries = Object.entries(ft?.ranges ?? {}).filter(([r]) => !allowedRanges || allowedRanges.includes(r));
    const variants = ft
      ? [...ft.variants.map((v) => v.variant), ...rangeEntries.flatMap(([r, vs]) => vs.map((v) => `${r}/${v.variant}`))]
      : ['default'];
    targets.set(e.template, {
      template: e.template,
      first: e,
      variants,
      ranges: rangeEntries.map(([r]) => r),
      rangeVariables: e.folderRules.flatMap((r) => r.variables),
      locales: e.fixedLocale ? [e.fixedLocale] : config.locales,
      ...(e.fixedLocale ? { fixedLocale: e.fixedLocale } : {}),
      missingTemplate: !ft,
    });
  }

  // Index objet normalisé → gabarits (toutes langues, toutes variantes d'objet).
  const bySubject = new Map<string, Set<string>>();
  for (const e of bpmn.emails) {
    if (!e.template || !targets.has(e.template)) continue;
    for (const list of Object.values(e.subjects)) {
      for (const s of list) {
        const k = normalizeSubject(s);
        bySubject.set(k, (bySubject.get(k) ?? new Set()).add(e.template));
      }
    }
  }

  const reach = new Map<string, { tests: TestRef[]; capturedBy: CaptureRef[] }>();
  const cellKey = (t: string, v: string, l: string) => `${t}|${v}|${l}`;
  const unattributed = new Map<string, UnattributedEmail>();
  const flag = (subject: string, reason: UnattributedEmail['reason'], templates: string[], t: ScannedTest) => {
    const k = `${reason}|${subject}`;
    const u = unattributed.get(k) ?? { subject, reason, templates, tests: [] };
    if (!u.tests.some((x) => x.id === t.fullTitle)) u.tests.push(testRef(t));
    unattributed.set(k, u);
  };
  const add = (target: Target, variant: string, locales: string[], t: ScannedTest, capture: boolean, shot: string | null = null) => {
    for (const loc of target.fixedLocale ? [target.fixedLocale] : locales) {
      if (!target.locales.includes(loc)) continue;
      const k = cellKey(target.template, variant, loc);
      const r = reach.get(k) ?? { tests: [], capturedBy: [] };
      if (!r.tests.some((x) => x.id === t.fullTitle)) r.tests.push(testRef(t));
      if (capture && !r.capturedBy.some((x) => x.id === t.fullTitle)) r.capturedBy.push({ ...testRef(t), ...(shot ? { shot } : {}) });
      reach.set(k, r);
    }
  };

  for (const { test, locales } of perTest) {
    const resolveSubject = (subject: string): Target | null => {
      const templates = [...(bySubject.get(normalizeSubject(subject)) ?? [])];
      if (templates.length === 0) {
        flag(subject, 'unknown-subject', [], test);
        return null;
      }
      if (templates.length > 1) {
        flag(subject, 'shared-subject', templates.sort(), test);
        return null;
      }
      return targets.get(templates[0]!) ?? null;
    };
    const captured = new Set(test.emailCaptures.map((c) => c.subject).filter((s): s is string => !!s).map(normalizeSubject));
    for (const subject of test.emailSubjects) {
      if (captured.has(normalizeSubject(subject))) continue; // traité avec sa capture
      const target = resolveSubject(subject);
      if (!target) continue;
      const v = variantFor(target, test, null, config);
      if (v) add(target, v, locales, test, false);
      else flag(subject, 'variant', [target.template], test);
    }
    for (const c of test.emailCaptures) {
      if (!c.subject) continue;
      const target = resolveSubject(c.subject);
      if (!target) continue;
      const v = variantFor(target, test, c.suffix, config);
      if (v) add(target, v, locales, test, true, c.name);
      else flag(c.subject, 'variant', [target.template], test);
    }
  }

  const emails: EmailCoverage[] = [...targets.values()].map((t) => ({
    template: t.template,
    taskId: t.first.taskId,
    trigger: t.first.trigger,
    missingTemplate: t.missingTemplate,
    variants: t.variants.map((variant) => ({
      variant,
      byLocale: Object.fromEntries(
        t.locales.map((loc): [string, Cell] => {
          const r = reach.get(cellKey(t.template, variant, loc)) ?? { tests: [], capturedBy: [] };
          return [loc, { status: r.capturedBy.length ? 'covered' : r.tests.length ? 'traversed' : 'missing', ...r }];
        }),
      ),
    })),
  }));

  const orphanTemplates = front.emails.map((e) => e.template).filter((t) => !sentTemplates.has(t));
  return { emails, orphanTemplates, unattributed: [...unattributed.values()], excluded, warnings };
}
