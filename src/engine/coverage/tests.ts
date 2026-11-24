import type { Suite, TestRef } from '../../core/coverage';
import { fallbackLocale, type JourneyConfig } from '../../core/journey';
import type { ScannedTest } from '../parsers/scanTests';

/** Rattachement des tests au parcours et lecture de leur langue (§5.3, §4). */

export const testRef = (t: ScannedTest): TestRef => ({ id: t.fullTitle, file: t.file, line: t.line });

const under = (file: string, spec: string): boolean => {
  const s = spec.replace(/\/+$/, '');
  return file === s || file.startsWith(`${s}/`);
};

export function suiteOf(file: string): Suite | null {
  if (file.startsWith('tests/ui/')) return 'ui';
  if (file.startsWith('tests/workflow/')) return 'workflow';
  return null;
}

export interface Attachment {
  tests: ScannedTest[];
  /** Tests de specs partagées qui n'appellent aucun configurateur du parcours. */
  ignored: TestRef[];
}

/**
 * Tests du parcours pour une suite : ceux de ses specs, plus ceux des specs
 * partagées qui appellent un configurateur du parcours.
 */
export function attachTests(tests: ScannedTest[], config: JourneyConfig, suite: Suite): Attachment {
  const configurers = new Set(config.caseConfigurers ?? []);
  const out: ScannedTest[] = [];
  const ignored: TestRef[] = [];
  for (const t of tests) {
    if (suiteOf(t.file) !== suite) continue;
    if (config.specs.some((s) => under(t.file, s))) out.push(t);
    else if ((config.sharedSpecs ?? []).some((s) => under(t.file, s))) {
      if (t.configurers.some((c) => configurers.has(c))) out.push(t);
      else ignored.push(testRef(t));
    }
  }
  return { tests: out, ignored };
}

/**
 * Langues du cas joué par le test. `null` = langue inconnue (zone grise) :
 * illisible, ou absente sans défaut possible.
 */
export function testLocales(t: ScannedTest, config: Pick<JourneyConfig, 'locales' | 'defaultLocale'>): string[] | null {
  if (t.locales.length) return t.locales;
  if (t.localeUnknown) return null;
  const fb = fallbackLocale(config);
  return fb ? [fb] : null;
}
