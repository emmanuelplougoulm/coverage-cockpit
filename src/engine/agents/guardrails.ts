import type { RepoInfo, RepoKey } from '../../core/contract';
import type { RunKind } from '../../core/agents';

/**
 * Garde-fous imposés aux agents (§13) : liste d'outils refusés + consigne.
 * Lecture seule sur front et workflow ; écriture limitée au dépôt de tests,
 * sur branche locale, jamais la principale, jamais de push.
 */

export const MODELS = (env: NodeJS.ProcessEnv = process.env) => ({
  /** Intermédiaire : écriture et demandes. */
  write: env.CC_AGENT_MODEL?.trim() || 'claude-sonnet-5-5',
  /** Le plus puissant : onboarding. */
  strong: env.CC_AGENT_MODEL_STRONG?.trim() || 'claude-opus-5-5',
});

export const modelFor = (kind: RunKind, env: NodeJS.ProcessEnv = process.env) => (kind === 'onboarding' ? MODELS(env).strong : MODELS(env).write);

/** Commande de l'agent : `claude` par défaut ; `CC_AGENT_CMD` la remplace (faux agent du corpus). */
export const agentCommand = (env: NodeJS.ProcessEnv = process.env): string[] => (env.CC_AGENT_CMD?.trim() || 'claude').split(/\s+/).filter(Boolean);

export const writes = (kind: RunKind) => kind === 'generation';

export function disallowedTools(repos: Record<RepoKey, RepoInfo>): string[] {
  const ro = [repos.front.path, repos.workflow.path];
  return [
    'Bash(git push:*)',
    'Bash(git push)',
    'Bash(git checkout main*)',
    'Bash(git checkout master*)',
    'Bash(git switch main*)',
    'Bash(git switch master*)',
    'Bash(git reset --hard*)',
    'Bash(git rebase*)',
    'Bash(rm -rf*)',
    'Bash(curl:*)',
    'WebFetch',
    'Read(**/.env*)',
    'Read(**/*.pem)',
    'Read(**/*.key)',
    'Read(**/*.p12)',
    'Read(**/*.png)',
    'Read(**/*.jpg)',
    'Read(**/*.jpeg)',
    'Read(**/*.pdf)',
    'Read(**/fixtures/documents/**)',
    ...ro.flatMap((p) => [`Edit(${p}/**)`, `Write(${p}/**)`]),
  ];
}

export function allowedTools(kind: RunKind): string[] {
  const read = ['Read', 'Grep', 'Glob'];
  if (kind === 'onboarding') return [...read, 'Bash(pnpm onboard:*)', 'Bash(pnpm -s onboard:*)', 'Edit', 'Write'];
  if (!writes(kind)) return read;
  return [...read, 'Edit', 'Write', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(npx playwright test:*)', 'Bash(pnpm exec playwright test:*)'];
}

export function guardrailPrompt(kind: RunKind, ctx: { branch: string | null; e2e: string; front: string; workflow: string; notes: string[] }): string {
  const lines = [
    'Règles impératives de Coverage Cockpit (ne jamais y déroger) :',
    `- Lecture seule sur le front (${ctx.front}) et le workflow (${ctx.workflow}).`,
    writes(kind)
      ? `- Écriture limitée au dépôt de tests (${ctx.e2e}), sur la branche locale ${ctx.branch ? `« ${ctx.branch} »` : 'courante'} ; jamais la branche principale ; jamais de push.`
      : '- Tu ne modifies aucun fichier des dépôts : lecture seule.',
    '- Ne lis jamais les fichiers d’environnement, certificats, pièces justificatives de test ni images PNG.',
    '- Complète un test existant avant d’en écrire un nouveau ; un seul dossier pour toute la chaîne.',
    '- Annonce le coût estimé avant d’écrire du code.',
    '- Erreurs techniques provoquées sans mock (réseau coupé, caméra refusée, épuisement réel) : jamais page.route.',
    '- Même en échec, commite avec la mention « WIP » et la raison.',
    '- Termine par un bloc « QUESTIONS : » si tu attends une décision.',
    ...ctx.notes.map((n) => `- Note : ${n}`),
  ];
  return lines.join('\n');
}

/** Arguments de la CLI (hors commande). Le modèle est celui du run, épinglé à chaque reprise. */
export function cliArgs(o: {
  prompt: string;
  model: string;
  sessionId: string | null;
  kind: RunKind;
  repos: Record<RepoKey, RepoInfo>;
  system: string;
  extraDirs?: string[];
}): string[] {
  return [
    '-p',
    o.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    o.model,
    ...(o.sessionId ? ['--resume', o.sessionId] : []),
    '--append-system-prompt',
    o.system,
    '--add-dir',
    o.repos.front.path,
    '--add-dir',
    o.repos.workflow.path,
    ...(o.extraDirs ?? []).flatMap((d) => ['--add-dir', d]),
    '--allowedTools',
    ...allowedTools(o.kind),
    '--disallowedTools',
    ...disallowedTools(o.repos),
  ];
}
