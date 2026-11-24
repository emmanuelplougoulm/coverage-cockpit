import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_DIRS, type RunKind, type RunState, type RunSummary, type SpendSummary } from '../../core/agents';
import { readJson, writeJsonAtomic } from '../store/dataDir';
import { parseStream, questionsOf } from './stream';

/**
 * Runs d'agents (§13) : chaque échange est un processus détaché ; la session
 * est reprise à chaque réponse de l'utilisateur avec le MÊME modèle. Journaux,
 * erreurs et code de sortie dans des fichiers par tour ; l'app les relit.
 */

export interface LaunchSpec {
  cwd: string;
  cmd: string[];
  out: string;
  err: string;
  exit: string;
}
export type Launcher = (spec: LaunchSpec) => number | null;

/**
 * Shell de connexion (PATH de l'utilisateur, comme run_engine), arguments par
 * "$@" (jamais interpolés), code de sortie écrit à la fin.
 */
const SCRIPT = 'cd -- "$1" || { echo 97 > "$4"; exit 97; }; out=$2; err=$3; ex=$4; shift 4; "$@" > "$out" 2> "$err" < /dev/null; echo $? > "$ex"';

export const detachedLauncher: Launcher = ({ cwd, cmd, out, err, exit }) => {
  const child = spawn('/bin/zsh', ['-lc', SCRIPT, 'cc-agent', cwd, out, err, exit, ...cmd], { detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid ?? null;
};

export const isAlive = (pid: number | null | undefined): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

export class RunStore {
  constructor(
    private readonly dataDir: string,
    private readonly launcher: Launcher = detachedLauncher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  dirOf(kind: RunKind, id: string): string {
    return join(this.dataDir, 'runs', RUN_DIRS[kind], id);
  }

  create(o: { kind: RunKind; journey: string | null; title: string; model: string; cwd: string; phase?: string; branch?: string | null; notes?: string[] }): RunState {
    const t = this.now();
    const id = `${t.toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${randomBytes(3).toString('hex')}`;
    const state: RunState = {
      id,
      kind: o.kind,
      journey: o.journey,
      title: o.title,
      model: o.model,
      sessionId: null,
      status: 'waiting',
      ...(o.phase ? { phase: o.phase } : {}),
      branch: o.branch ?? null,
      cwd: o.cwd,
      createdAt: t.toISOString(),
      updatedAt: t.toISOString(),
      turns: [],
      totalCost: 0,
      questions: [],
      notes: o.notes ?? [],
    };
    mkdirSync(this.dirOf(o.kind, id), { recursive: true });
    this.save(state);
    return state;
  }

  save(s: RunState): void {
    s.updatedAt = this.now().toISOString();
    writeJsonAtomic(join(this.dirOf(s.kind, s.id), 'state.json'), s);
  }

  /** Lance un tour. `args` = arguments de la CLI hors prompt (le modèle y est déjà épinglé). */
  startTurn(s: RunState, prompt: string, args: (sessionId: string | null) => string[], cmd: string[], phase?: string): RunState {
    if (s.status === 'running') throw new Error('un tour tourne déjà');
    const n = s.turns.length + 1;
    const dir = this.dirOf(s.kind, s.id);
    writeFileSync(join(dir, `turn-${n}.prompt.txt`), prompt);
    const pid = this.launcher({
      cwd: s.cwd,
      cmd: [...cmd, ...args(s.sessionId)],
      out: join(dir, `turn-${n}.jsonl`),
      err: join(dir, `turn-${n}.err`),
      exit: join(dir, `turn-${n}.exit`),
    });
    s.turns.push({ n, prompt, ...(phase ? { phase } : {}), startedAt: this.now().toISOString(), messages: [], tools: [] });
    if (phase) s.phase = phase;
    s.pid = pid;
    s.status = 'running';
    this.save(s);
    return s;
  }

  /** Relit les fichiers du dernier tour et met l'état à jour. */
  refresh(s: RunState): RunState {
    const turn = s.turns.at(-1);
    if (!turn || s.status !== 'running') return s;
    const dir = this.dirOf(s.kind, s.id);
    const parsed = parseStream(read(join(dir, `turn-${turn.n}.jsonl`)));
    turn.messages = parsed.messages;
    turn.tools = parsed.tools;
    if (parsed.sessionId) s.sessionId = parsed.sessionId;
    const exitRaw = read(join(dir, `turn-${turn.n}.exit`)).trim();
    if (!exitRaw) {
      if (!isAlive(s.pid)) {
        turn.error = 'processus disparu sans code de sortie';
        turn.endedAt = this.now().toISOString();
        s.status = 'failed';
        this.save(s);
      }
      return s;
    }
    turn.exitCode = Number(exitRaw);
    turn.endedAt = this.now().toISOString();
    // Coût annoncé cumulatif : le coût du tour est la différence avec le précédent.
    const prev = [...s.turns].reverse().find((t) => t !== turn && typeof t.cost === 'number')?.cost ?? 0;
    if (parsed.result?.cost !== null && parsed.result?.cost !== undefined) {
      turn.cost = parsed.result.cost;
      turn.costDelta = Math.round((parsed.result.cost >= prev ? parsed.result.cost - prev : parsed.result.cost) * 1e6) / 1e6;
      s.totalCost = Math.round((s.totalCost + turn.costDelta) * 1e6) / 1e6;
    }
    if (parsed.result?.text) turn.result = parsed.result.text;
    const errText = read(join(dir, `turn-${turn.n}.err`)).trim();
    if (turn.exitCode !== 0 || parsed.result?.isError) turn.error = (errText || parsed.result?.subtype || `code ${turn.exitCode}`).slice(-300);
    s.status = turn.exitCode === 0 && !parsed.result?.isError ? 'waiting' : 'failed';
    s.questions = questionsOf(turn.result ?? turn.messages.at(-1));
    s.pid = null;
    this.save(s);
    return s;
  }

  get(kind: RunKind, id: string): RunState {
    const s = readJson<RunState>(join(this.dirOf(kind, id), 'state.json'));
    if (!s) throw new Error(`run introuvable : ${id}`);
    return this.refresh(s);
  }

  /** Cherche un run par id dans tous les types. */
  find(id: string): RunState {
    for (const kind of Object.keys(RUN_DIRS) as RunKind[]) {
      if (existsSync(join(this.dirOf(kind, id), 'state.json'))) return this.get(kind, id);
    }
    throw new Error(`run introuvable : ${id}`);
  }

  list(kind?: RunKind): RunState[] {
    const kinds = kind ? [kind] : (Object.keys(RUN_DIRS) as RunKind[]);
    const out: RunState[] = [];
    for (const k of kinds) {
      const base = join(this.dataDir, 'runs', RUN_DIRS[k]);
      if (!existsSync(base)) continue;
      for (const id of readdirSync(base)) {
        try {
          out.push(this.get(k, id));
        } catch {
          /* dossier incomplet : ignoré */
        }
      }
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  stop(s: RunState): RunState {
    if (s.pid && isAlive(s.pid)) {
      try {
        process.kill(-s.pid, 'SIGTERM');
      } catch {
        try {
          process.kill(s.pid, 'SIGTERM');
        } catch {
          /* déjà fini */
        }
      }
    }
    const turn = s.turns.at(-1);
    if (turn && !turn.endedAt) {
      turn.endedAt = this.now().toISOString();
      turn.error = "arrêté par l'utilisateur";
    }
    s.status = 'stopped';
    s.pid = null;
    this.save(s);
    return s;
  }

  setStatus(s: RunState, status: 'closed' | 'waiting'): RunState {
    if (s.status === 'running') throw new Error('arrêter le tour avant');
    s.status = status;
    this.save(s);
    return s;
  }
}

export function summarize(s: RunState): RunSummary {
  const last = s.turns.at(-1);
  return {
    id: s.id,
    kind: s.kind,
    journey: s.journey,
    title: s.title,
    model: s.model,
    status: s.status,
    ...(s.phase ? { phase: s.phase } : {}),
    branch: s.branch ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    totalCost: s.totalCost,
    turns: s.turns.length,
    lastMessage: last?.result ?? last?.messages.at(-1) ?? null,
  };
}

/** Dépenses IA (§7) : total, aujourd'hui, par type, par parcours. */
export function spendOf(runs: RunState[], today = new Date().toISOString().slice(0, 10)): SpendSummary {
  const out: SpendSummary = { total: 0, today: 0, byKind: {}, byJourney: {}, runs: runs.length };
  for (const r of runs) {
    for (const t of r.turns) {
      const c = t.costDelta ?? 0;
      out.total += c;
      if ((t.endedAt ?? t.startedAt).startsWith(today)) out.today += c;
      out.byKind[r.kind] = (out.byKind[r.kind] ?? 0) + c;
      const j = r.journey ?? '—';
      out.byJourney[j] = (out.byJourney[j] ?? 0) + c;
    }
  }
  const round = (n: number) => Math.round(n * 1e4) / 1e4;
  out.total = round(out.total);
  out.today = round(out.today);
  for (const m of [out.byKind, out.byJourney]) for (const k of Object.keys(m)) m[k] = round(m[k]!);
  return out;
}
