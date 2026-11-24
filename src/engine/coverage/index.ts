import type { CoverageView, Suite, TestRef } from '../../core/coverage';
import type { JourneyConfig } from '../../core/journey';
import type { Knowledge } from '../../core/knowledge';
import { applyCatalog, assignBricks } from '../knowledge/apply';
import type { BpmnModel } from '../parsers/bpmn';
import type { FrontModel } from '../parsers/front';
import type { ScanResult } from '../parsers/scanTests';
import { computeBpmn } from './bpmnCoverage';
import { computeEmails } from './emails';
import { resolveNominal } from './nominal';
import { ref } from './resolve';
import { computeScreens, resolveTest } from './screens';
import { attachTests, testLocales, testRef } from './tests';

/** Titre (ou texte du message) de chaque état, dans la langue par défaut sinon la première. */
function mainTexts(front: FrontModel, config: JourneyConfig): Record<string, string> {
  const locale = config.defaultLocale ?? config.locales[0] ?? front.locales[0];
  const texts = (locale && front.texts[locale]) || {};
  const out: Record<string, string> = {};
  for (const [ref, t] of Object.entries(texts)) {
    const main = t.title ?? t.text;
    if (main) out[ref] = main;
  }
  return out;
}

/**
 * Vue de couverture d'un parcours pour une suite (§6). Pure : prend les trois
 * modèles déjà lus, rend la vue. `ui` = tests qui capturent des écrans ;
 * `workflow` = la même vue sur la suite BPMN / API.
 */
export function computeCoverage(
  declared: JourneyConfig,
  suite: Suite,
  sources: { bpmn: BpmnModel; front: FrontModel; scan: ScanResult },
  knowledge?: Knowledge,
): CoverageView {
  const { bpmn, front, scan } = sources;
  // Catalogue de décisions : complète la config là où elle ne dit rien.
  const { config, outcome } = knowledge ? applyCatalog(declared, knowledge.decisions, bpmn, front) : { config: declared, outcome: { applied: [], pending: [] } };
  const warnings = [...scan.warnings, ...front.warnings];
  const { tests, ignored } = attachTests(scan.tests, config, suite);

  const excludedGroups = new Set(config.excludedGroups);
  const excludedStates = new Set(config.excludedStates);
  const inScope = (r: string) => !excludedStates.has(r) && !excludedGroups.has(r.slice(0, r.indexOf('.')));
  const ctx = { states: front.states, config };

  const unknownLocaleTests: TestRef[] = [];
  const perTest = [];
  for (const t of tests) {
    const locales = testLocales(t, config);
    if (!locales) {
      unknownLocaleTests.push(testRef(t));
      continue;
    }
    const foreign = locales.filter((l) => !config.locales.includes(l));
    if (foreign.length) warnings.push(`${t.file}:${t.line} : langue hors parcours ${foreign.join(', ')}`);
    perTest.push({ test: t, locales: locales.filter((l) => config.locales.includes(l)), reach: resolveTest(t, ctx, inScope) });
  }

  const screens = computeScreens(front.states, config, perTest);
  const mails = computeEmails(bpmn, front, config, perTest);
  const bpmnElements = computeBpmn(bpmn, config, screens.sessions, mails.emails);

  // Alias ou états de config qui ne désignent rien : erreur de config, à voir.
  const known = new Set(front.states.map(ref));
  for (const [k, v] of Object.entries({ ...config.stepAliases, ...config.methodStates })) {
    if (!known.has(v)) warnings.push(`config : ${k} → ${v} ne désigne aucun état du front`);
  }
  for (const s of config.excludedStates) if (!known.has(s)) warnings.push(`config : état exclu inconnu ${s}`);

  return {
    journey: config.id,
    suite,
    locales: config.locales,
    testsScanned: tests.length,
    tests: tests.map(testRef),
    sessions: screens.sessions,
    emails: mails.emails,
    orphanTemplates: mails.orphanTemplates,
    bpmn: bpmnElements,
    excluded: [
      ...screens.excluded,
      ...mails.excluded,
      ...ignored.map((t) => ({ id: t.id, reason: 'spec partagée sans configurateur du parcours' })),
    ],
    ambiguous: screens.ambiguous,
    unattributed: mails.unattributed,
    unknownLocaleTests,
    nominal: resolveNominal(config, front, scan, bpmn),
    escalationEnds: config.escalationEnds ?? [],
    transitions: front.transitions,
    texts: mainTexts(front, config),
    testTags: Object.fromEntries(tests.map((t) => [t.fullTitle, [...t.tags, ...t.ownTags]])),
    catalog: outcome,
    testChecks: Object.fromEntries(tests.map((t) => [t.fullTitle, t.checks])),
    testSessions: Object.fromEntries(tests.filter((t) => t.sessions.length).map((t) => [t.fullTitle, [...new Set(t.sessions)]])),
    bricks: knowledge
      ? assignBricks(
          knowledge.bricks,
          screens.sessions.map((s) => s.group),
          screens.sessions.flatMap((s) => s.states.map((st) => `${st.group}.${st.key}`)),
          bpmn.elements
            .filter((e) => e.type === 'subProcess')
            .map((e) => {
              const s = bpmn.sessions.find((x) => x.id === e.id);
              const groups = config.bpmnSessions?.[e.id] ?? (s?.sessionName ? [s.sessionName] : []);
              return { id: e.id, ...(e.name ? { name: e.name } : {}), groups };
            }),
        )
      : [],
    warnings: [...warnings, ...mails.warnings],
  };
}
