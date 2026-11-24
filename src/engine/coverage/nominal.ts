import type { NominalResolution } from '../../core/coverage';
import type { JourneyConfig, NominalPath } from '../../core/journey';
import type { BpmnModel } from '../parsers/bpmn';
import type { FrontModel } from '../parsers/front';
import type { ScanResult } from '../parsers/scanTests';

/**
 * Chemin nominal (§8) : (1) déclaré dans la config, (2) sinon lu dans le
 * premier test workflow @P1, (3) sinon proposé depuis le BPMN. La proposition
 * ne sert qu'à proposer : jamais à contrôler.
 */

/**
 * Écrans d'une session en suivant la première sortie (hors écrans exclus) de
 * chaque carte d'étape ; on s'arrête dès qu'elle quitte la session, sans
 * chercher une autre sortie (qui mènerait vers un écran d'échec).
 */
export function walkSession(group: string, front: FrontModel, excluded: Set<string>): string[] {
  const steps = front.states.filter((s) => s.group === group && s.kind === 'step').map((s) => `${s.group}.${s.key}`);
  const next = new Map(front.transitions.map((t) => [t.from, t.to]));
  const out: string[] = [];
  let cur = steps.find((r) => !excluded.has(r));
  while (cur && !out.includes(cur) && cur.startsWith(`${group}.`)) {
    out.push(cur);
    const first = (next.get(cur) ?? []).find((r) => !excluded.has(r));
    cur = first && first.startsWith(`${group}.`) && !out.includes(first) ? first : undefined;
  }
  return out;
}

export function resolveNominal(config: JourneyConfig, front: FrontModel, scan: ScanResult, bpmn: BpmnModel): NominalResolution {
  if (config.nominalPaths?.length) return { source: 'config', confidence: 'haute', paths: config.nominalPaths };

  const excluded = new Set(config.excludedStates);
  const inScope = (g: string) => g in config.sessions && !config.excludedGroups.includes(g);

  const p1 = scan.tests
    .filter((t) => t.file.startsWith('tests/workflow/') && [...t.tags, ...t.ownTags].includes('@P1') && t.sessions.some(inScope))
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))[0];
  if (p1) {
    const groups = [...new Set(p1.sessions.filter(inScope))];
    const path: NominalPath = {
      id: 'p1',
      label: 'Chemin @P1',
      screens: groups.flatMap((g) => walkSession(g, front, excluded)),
      setup: `Cas du test workflow @P1 « ${p1.title} » : ${JSON.stringify(p1.caseValues)}`,
      from: p1.fullTitle,
    };
    return { source: 'p1', confidence: 'moyenne', paths: [path], evidence: `${p1.file}:${p1.line}` };
  }

  const groups = bpmn.sessions
    .flatMap((s) => config.bpmnSessions?.[s.id] ?? (s.sessionName ? [s.sessionName] : []))
    .filter(inScope);
  const screens = [...new Set(groups)].flatMap((g) => walkSession(g, front, excluded));
  if (screens.length) {
    return {
      source: 'bpmn',
      confidence: 'basse',
      paths: [{ id: 'bpmn', label: 'Proposé depuis le BPMN', screens, setup: 'Cas par défaut du parcours (proposition à valider).' }],
      evidence: 'ordre des sessions du BPMN, première sortie de chaque étape',
    };
  }
  return { source: null, confidence: null, paths: [] };
}
