import type { BpmnCoverageElement, EmailCoverage, SessionCoverage } from '../../core/coverage';
import type { CellStatus } from '../../core/fixture';
import type { JourneyConfig } from '../../core/journey';
import type { BpmnModel } from '../parsers/bpmn';

/**
 * Couverture du BPMN (§6) : sessions, e-mails, branches. Un élément sans lien
 * décidé est `unlinked` (zone grise) ; un élément exclu sort du total.
 */

type Rank = 'missing' | 'traversed' | 'covered';
const best = (xs: Rank[]): Rank => (xs.includes('covered') ? 'covered' : xs.includes('traversed') ? 'traversed' : 'missing');

export function computeBpmn(
  bpmn: BpmnModel,
  config: JourneyConfig,
  sessions: SessionCoverage[],
  emails: EmailCoverage[],
): BpmnCoverageElement[] {
  const excludedSteps = new Set(config.excludedBpmnSteps);
  const technical = new Set(config.bpmnTechnicalSteps ?? []);
  const excludedGroups = new Set(config.excludedGroups);
  const excludedTriggers = new Set(config.excludedEmailTriggers);
  const excludedTemplates = new Set(config.excludedEmailTemplates ?? []);

  // Statut le meilleur toutes langues confondues, par état et par e-mail.
  const stateStatus = new Map<string, Rank>();
  for (const s of sessions) {
    for (const st of s.states) stateStatus.set(`${st.group}.${st.key}`, best(Object.values(st.byLocale).map((c) => c.status)));
  }
  const emailStatus = new Map<string, Rank>();
  for (const e of emails) {
    emailStatus.set(`email:${e.template}`, best(e.variants.flatMap((v) => Object.values(v.byLocale).map((c) => c.status))));
  }
  const statusOfLinks = (links: string[]): Rank => best(links.map((l) => stateStatus.get(l) ?? emailStatus.get(l) ?? 'missing'));
  const inExcludedStep = (scope: string[], id?: string) => [...scope, ...(id ? [id] : [])].some((s) => excludedSteps.has(s));

  const out: BpmnCoverageElement[] = [];

  for (const s of bpmn.sessions) {
    const label = s.name ?? s.id;
    const groups = config.bpmnSessions?.[s.id] ?? (s.sessionName ? [s.sessionName] : []);
    const source = config.bpmnSessions?.[s.id] ? 'config' : s.sessionName ? 'sessionName' : undefined;
    const base = { id: s.id, kind: 'session' as const, label, ...(source ? { source } : {}) };
    if (inExcludedStep(s.scope, s.id)) {
      out.push({ ...base, status: 'excluded', links: [], reason: 'sous-processus hors périmètre (config)' });
      continue;
    }
    if (groups.length && groups.every((g) => excludedGroups.has(g))) {
      out.push({ ...base, status: 'excluded', links: [], reason: 'session hébergée hors périmètre (config)' });
      continue;
    }
    if (!groups.length) {
      out.push({ ...base, status: 'unlinked', links: [], reason: `sessionName non évaluable (${s.sessionNameExpression ?? 'absent'}) : à déclarer dans bpmnSessions` });
      continue;
    }
    const links = sessions.filter((x) => groups.includes(x.group)).flatMap((x) => x.states.map((st) => `${st.group}.${st.key}`));
    if (!links.length) {
      out.push({ ...base, status: 'unlinked', links: [], reason: `aucun état front pour ${groups.join(', ')}` });
      continue;
    }
    out.push({ ...base, status: statusOfLinks(links), links });
  }

  for (const e of bpmn.emails) {
    const id = e.taskId;
    const label = e.template ?? e.taskName ?? e.taskId;
    const base = { id, kind: 'email' as const, label, scope: e.scope };
    if (!e.template) {
      out.push({ ...base, status: 'unlinked', links: [], reason: 'modèle non évaluable' });
      continue;
    }
    const link = `email:${e.template}`;
    let reason: string | undefined;
    if (inExcludedStep(e.scope)) reason = 'sous-processus hors périmètre (config)';
    else if (excludedTriggers.has(e.trigger)) reason = `déclencheur ${e.trigger} hors périmètre (config)`;
    else if (excludedTemplates.has(e.template)) reason = 'gabarit hors périmètre (config)';
    if (reason) out.push({ ...base, status: 'excluded', links: [link], reason });
    else out.push({ ...base, status: statusOfLinks([link]), links: [link], source: 'template' });
  }

  for (const b of bpmn.branches) {
    const owner = b.scope.at(-1);
    if (owner && technical.has(owner)) continue; // sous-processus sans écran : non listé
    const label = b.name ?? b.flowId;
    const base = { id: b.key, kind: 'branch' as const, label, scope: b.scope };
    if (inExcludedStep(b.scope)) {
      out.push({ ...base, status: 'excluded', links: [], reason: 'sous-processus hors périmètre (config)' });
      continue;
    }
    const links = config.bpmnBranches?.[b.key];
    const source = config.bpmnBranchSources?.[b.key] ?? 'config';
    if (links === undefined) {
      out.push({ ...base, status: 'unlinked', links: [], reason: 'aucune preuve décidée (config bpmnBranches ou catalogue)' });
      continue;
    }
    if (links.length === 0) {
      out.push({ ...base, status: 'excluded', links: [], source, reason: 'rien de visible ne prouve la branche (décidé)' });
      continue;
    }
    const status: CellStatus = statusOfLinks(links);
    out.push({ ...base, status, links, source });
  }

  return out;
}
