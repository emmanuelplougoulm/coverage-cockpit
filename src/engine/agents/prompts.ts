import type { RepoInfo, RepoKey } from '../../core/contract';
import type { RunKind } from '../../core/agents';
import type { JourneyConfig } from '../../core/journey';

/**
 * Prompts des runs (§13). Chaque prompt commence par un marqueur `cc:` (type,
 * phase, tour) : inoffensif pour l'agent, il sert au faux agent du corpus et
 * aux journaux.
 */

const marker = (kind: RunKind, turn: number, phase?: string) => `<!-- cc:kind=${kind}${phase ? ` cc:phase=${phase}` : ''} cc:turn=${turn} -->`;

function journeyBlock(c: JourneyConfig | null, repos: Record<RepoKey, RepoInfo>): string {
  if (!c) return `Dépôts : tests ${repos.e2e.path} · front ${repos.front.path} · workflow ${repos.workflow.path}`;
  return [
    `Parcours : ${c.label} (${c.id})`,
    `BPMN : ${repos.workflow.path}/${c.bpmnDir}`,
    `Front : ${repos.front.path}/${c.frontPackage}`,
    `Specs : ${c.specs.map((s) => `${repos.e2e.path}/${s}`).join(', ')}`,
    `Langues : ${c.locales.join(', ')}`,
  ].join('\n');
}

export function firstPrompt(
  kind: RunKind,
  o: { config: JourneyConfig | null; repos: Record<RepoKey, RepoInfo>; text: string; toolRoot: string; reportPath?: string; branch?: string | null },
): { prompt: string; phase?: string } {
  const ctx = journeyBlock(o.config, o.repos);
  switch (kind) {
    case 'generation':
      return {
        phase: 'design',
        prompt: [
          marker(kind, 1, 'design'),
          'Phase CONCEPTION d’un nouveau test. N’écris aucun code dans cette phase.',
          ctx,
          '',
          'Demande :',
          o.text,
          '',
          'Lis le registre, les tests et page objets existants ; propose les CAS (titre, écrans dans l’ordre, langues, captures, test existant à compléter d’abord). Annonce le coût estimé pour écrire et exécuter. Termine par « QUESTIONS : » si une décision est nécessaire.',
        ].join('\n'),
      };
    case 'onboarding':
      return {
        prompt: [
          marker(kind, 1),
          `Onboarding du parcours ${o.config?.id ?? o.text}.`,
          ctx,
          '',
          `1. Lance \`pnpm -s onboard ${o.config?.id ?? o.text}\` dans ${o.toolRoot} : il écrit un brouillon de config et un rapport (${o.reportPath ?? 'chemin donné par la commande'}).`,
          '2. Enquête sur chaque « point à trancher » dans le BPMN, le front et les tests (lecture seule).',
          '3. Remplace la section « Propositions » du rapport par un tableau « Proposition | Preuve (fichier:ligne) | Confiance » suivi de « Questions ouvertes ».',
          '4. ARRÊTE-TOI. N’applique rien sans validation explicite. Après validation seulement : appliquer, refaire typage / tests / `pnpm coverage` (0 différence) et proposer les décisions réutilisables au catalogue.',
        ].join('\n'),
      };
    case 'case-draft':
      return {
        prompt: [
          marker(kind, 1),
          'Rédige le brouillon du cas de test pour ce test existant (LECTURE SEULE, n’écris aucun fichier).',
          ctx,
          '',
          `Test : ${o.text}`,
          '',
          'Style de l’équipe, deux niveaux de détail. Rends UNIQUEMENT un bloc ```json { "title", "description", "preconditions", "steps": [{ "action", "data", "expected", "rendering" }] } ``` ; « rendering » nomme la capture de l’étape s’il y en a une.',
        ].join('\n'),
      };
    case 'sdk-analysis':
      return {
        prompt: [
          marker(kind, 1),
          'Analyse d’un ticket SDK (LECTURE SEULE).',
          `Fronts configurés : ${o.text.split('\n---\n')[1] ?? ''}`,
          '',
          'Ticket :',
          o.text.split('\n---\n')[0] ?? o.text,
          '',
          'Pour chaque parcours : « yes | no | unsure » + preuve fichier:ligne. Puis la fonctionnalité en une phrase.',
        ].join('\n'),
      };
    case 'request':
    default:
      return { prompt: [marker(kind, 1), 'Question sur le parcours (LECTURE SEULE, n’écris aucun fichier).', ctx, '', o.text].join('\n') };
  }
}

/** Réponse de l'utilisateur (reprise de session). `code` fait passer un Nouveau test à la phase CODE. */
export function replyPrompt(kind: RunKind, turn: number, text: string, phase?: string, branch?: string | null): string {
  if (kind === 'generation' && phase === 'code') {
    return [
      marker(kind, turn, 'code'),
      'Phase CODE : écris ou complète le test validé, exécute-le, puis commite localement',
      `${branch ? `sur la branche « ${branch} »` : 'sur la branche courante (jamais la principale)'} ; même en échec, commit « WIP » avec la raison. Ne pousse jamais.`,
      text ? `\nPrécisions de l’utilisateur :\n${text}` : '',
    ].join('\n');
  }
  return `${marker(kind, turn, phase)}\n${text}`;
}
