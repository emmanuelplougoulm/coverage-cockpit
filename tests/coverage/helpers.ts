import type { ScannedTest } from '../../src/engine/parsers/scanTests';
import type { JourneyConfig } from '../../src/core/journey';

/** Test scanné minimal, à compléter par cas. */
export function scanned(title: string, over: Partial<ScannedTest> = {}): ScannedTest {
  return {
    file: 'tests/ui/j/a.spec.ts', line: 1, fullTitle: title, title, describes: [], tags: [], ownTags: [],
    locales: ['fr'], localeUnknown: false, fixtures: ['page'], hasPage: true, steps: [], markers: [], screenshots: [],
    emailSubjects: [], emailCaptures: [], sessions: [], caseValues: {}, caseProperties: [], methods: [], configurers: [], checks: [], pages: [],
    ...over,
  };
}

export const baseConfig: JourneyConfig = {
  id: 'j', label: 'J', sessions: { B_STEPS: 'Signature', C_STEPS: 'Clôture' }, bpmnDir: 'b', frontPackage: 'f',
  specs: ['tests/ui/j', 'tests/workflow/j'], sharedSpecs: ['tests/ui/shared'], caseConfigurers: ['configureJ'],
  locales: ['fr', 'en'], excludedGroups: [], excludedStates: [], excludedBpmnSteps: [], excludedEmailTriggers: ['timer'],
};
