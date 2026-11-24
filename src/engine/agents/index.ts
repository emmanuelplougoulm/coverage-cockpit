import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { RepoInfo, RepoKey } from '../../core/contract';
import type { RunKind, RunState } from '../../core/agents';
import type { JourneyConfig } from '../../core/journey';
import { branchChoice, prepareBranch } from './branch';
import { agentCommand, cliArgs, guardrailPrompt, modelFor } from './guardrails';
import { firstPrompt, replyPrompt } from './prompts';
import { RunStore, type Launcher } from './runs';

/** Lancement et suite des runs (§13) : bord I/O autour du magasin de runs. */

export interface AgentEnv {
  repos: Record<RepoKey, RepoInfo>;
  dataDir: string;
  toolRoot: string;
  env?: NodeJS.ProcessEnv;
  launcher?: Launcher;
  now?: () => Date;
}

const store = (a: AgentEnv) => new RunStore(a.dataDir, a.launcher, a.now);

function argsFor(a: AgentEnv, s: RunState, prompt: string) {
  const system = guardrailPrompt(s.kind, { branch: s.branch ?? null, e2e: a.repos.e2e.path, front: a.repos.front.path, workflow: a.repos.workflow.path, notes: s.notes });
  return (sessionId: string | null) =>
    cliArgs({ prompt, model: s.model, sessionId, kind: s.kind, repos: a.repos, system, ...(s.kind === 'onboarding' ? { extraDirs: [a.toolRoot] } : {}) });
}

export function startRun(
  a: AgentEnv,
  kind: RunKind,
  config: JourneyConfig | null,
  text: string,
  opts: { title?: string; branch?: { stay: boolean; name?: string }; campaignKey?: string | null } = {},
): RunState {
  const env = a.env ?? process.env;
  let branch: string | null = null;
  let notes: string[] = [];
  if (kind === 'generation') {
    const choice = branchChoice(a.repos.e2e.path, config?.id ?? 'parcours', kind, opts.campaignKey ?? null, a.now?.());
    ({ branch, notes } = prepareBranch(a.repos.e2e.path, choice, opts.branch ?? { stay: false }));
  }
  const s = store(a).create({
    kind,
    journey: config?.id ?? null,
    title: opts.title ?? text.split('\n')[0]!.slice(0, 120),
    model: modelFor(kind, env),
    cwd: a.repos.e2e.exists ? a.repos.e2e.path : a.toolRoot,
    branch,
    notes,
  });
  const reportPath = join(a.dataDir, 'onboarding-drafts', config?.id ?? text, 'rapport.md');
  const { prompt, phase } = firstPrompt(kind, { config, repos: a.repos, text, toolRoot: a.toolRoot, reportPath, branch });
  return store(a).startTurn(s, prompt, argsFor(a, s, prompt), agentCommand(env), phase);
}

export function replyRun(a: AgentEnv, id: string, text: string, phase?: string): RunState {
  const st = store(a);
  const s = st.find(id);
  if (s.status === 'running') throw new Error('l’agent travaille encore : attendre la fin du tour');
  if (s.status === 'closed') throw new Error('run clôturé : le rouvrir d’abord');
  if (!s.sessionId) throw new Error('pas de session à reprendre (le premier tour a échoué)');
  const prompt = replyPrompt(s.kind, s.turns.length + 1, text, phase ?? s.phase, s.branch);
  return st.startTurn(s, prompt, argsFor(a, s, prompt), agentCommand(a.env ?? process.env), phase ?? s.phase);
}

export const getRun = (a: AgentEnv, id: string) => store(a).find(id);
export const stopRun = (a: AgentEnv, id: string) => store(a).stop(store(a).find(id));
export const setRunStatus = (a: AgentEnv, id: string, status: 'closed' | 'waiting') => store(a).setStatus(store(a).find(id), status);
export const listRuns = (a: AgentEnv, kind?: RunKind) => store(a).list(kind);

/** Notification système macOS (fin ou échec d'un run). `CC_NOTIFY=off` la coupe (corpus, tests). */
export function notify(title: string, message: string, env: NodeJS.ProcessEnv = process.env): { sent: boolean } {
  if (env.CC_NOTIFY === 'off') return { sent: false };
  try {
    execFileSync('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, message], { stdio: 'ignore', timeout: 5000 });
    return { sent: true };
  } catch {
    return { sent: false };
  }
}
