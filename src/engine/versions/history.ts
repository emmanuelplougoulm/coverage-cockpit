import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommitInfo, FetchResult, JourneyVersions, PublishedVersion } from '../../core/versions';
import { git, isGitTree } from '../store/fingerprint';

/**
 * Versions BPMN publiées (§12) = commits de la branche principale qui
 * incrémentent la version du `package.json` du processus. Lecture seule, sauf
 * `fetchAndUpdate` : `git fetch`, puis avance rapide SEULEMENT si le clone est
 * propre, sur sa branche principale, sans commit local.
 */

const SEP = '\x1f';
const TICKET = /\b[A-Z][A-Z0-9]+-\d+\b/g;

export const ticketsIn = (s: string): string[] => [...new Set(s.match(TICKET) ?? [])];

function log(root: string, range: string, paths: string[]): CommitInfo[] {
  const out = git(root, ['log', '--reverse', `--format=%H${SEP}%aI${SEP}%s`, range, '--', ...paths]) ?? '';
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash = '', date = '', subject = ''] = l.split(SEP);
      return { hash, date, subject, tickets: ticketsIn(subject) };
    });
}

const exists = (root: string, ref: string) => git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;

/** Branche principale : celle d'origin/HEAD, sinon main, sinon master. */
export function mainBranchOf(root: string): string | null {
  const head = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])?.trim();
  if (head) return head.replace(/^origin\//, '');
  for (const b of ['main', 'master']) if (exists(root, `refs/heads/${b}`) || exists(root, `refs/remotes/origin/${b}`)) return b;
  return null;
}

/** Comparaison de versions « a.b.c » (les parties non numériques comparées comme du texte). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    const c = Number.isNaN(nx) || Number.isNaN(ny) ? x.localeCompare(y) : nx - ny;
    if (c) return c;
  }
  return 0;
}

function versionAt(root: string, commit: string, pkg: string): string | null {
  const raw = git(root, ['show', `${commit}:${pkg}`]);
  if (raw === null) return null;
  try {
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export interface RepoState {
  isGit: boolean;
  branch: string | null;
  main: string | null;
  clean: boolean;
  ahead: number;
  behind: number;
  /** Référence où lire les versions publiées : la principale distante si connue. */
  publishedRef: string | null;
}

export function repoState(root: string): RepoState {
  if (!existsSync(root) || !isGitTree(root)) return { isGit: false, branch: null, main: null, clean: true, ahead: 0, behind: 0, publishedRef: null };
  const main = mainBranchOf(root);
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])?.trim() || null;
  const clean = (git(root, ['status', '--porcelain']) ?? '').trim() === '';
  let ahead = 0;
  let behind = 0;
  const remote = main && exists(root, `refs/remotes/origin/${main}`) ? `origin/${main}` : null;
  if (main && remote && exists(root, `refs/heads/${main}`)) {
    const [a = '0', b = '0'] = (git(root, ['rev-list', '--left-right', '--count', `${main}...${remote}`]) ?? '0\t0').trim().split(/\s+/);
    ahead = Number(a);
    behind = Number(b);
  }
  return { isGit: true, branch, main, clean, ahead, behind, publishedRef: remote ?? (main && exists(root, `refs/heads/${main}`) ? main : null) };
}

/** `git fetch` (30 s au plus), puis avance rapide si — et seulement si — c'est sans risque. */
export function fetchAndUpdate(root: string): FetchResult {
  if (!existsSync(root) || !isGitTree(root)) return { attempted: false, ok: false, error: 'pas un dépôt git', updated: false };
  try {
    execFileSync('git', ['-C', root, 'fetch', '--quiet', '--prune', 'origin'], { timeout: 30_000, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const err = e as { stderr?: Buffer; killed?: boolean; message?: string };
    const msg = err.killed ? 'délai de 30 s dépassé' : err.stderr?.toString().trim() || err.message || 'échec';
    return { attempted: true, ok: false, error: msg.slice(0, 300), updated: false };
  }
  const s = repoState(root);
  const skip = (skipped: string): FetchResult => ({ attempted: true, ok: true, updated: false, skipped });
  if (!s.main) return skip('branche principale introuvable');
  if (s.branch !== s.main) return skip(`le clone est sur « ${s.branch ?? 'HEAD détachée'} », pas sur ${s.main}`);
  if (!s.clean) return skip('modifications locales non commitées');
  if (s.ahead > 0) return skip(`${s.ahead} commit${s.ahead > 1 ? 's' : ''} local${s.ahead > 1 ? 'aux' : ''} non poussé${s.ahead > 1 ? 's' : ''}`);
  if (s.behind === 0) return { attempted: true, ok: true, updated: false };
  // Aucun commit local, clone propre, sur la principale : avance rapide pure (équivaut au rebase).
  if (git(root, ['merge', '--ff-only', '--quiet', `origin/${s.main}`]) === null) return skip('avance rapide impossible');
  return { attempted: true, ok: true, updated: true };
}

/** Versions publiées, commits livrés, non publiés, branches non fusionnées d'un processus. */
export function versionsOf(
  journey: string,
  root: string,
  bpmnDir: string,
  seen: string | null,
): JourneyVersions {
  const s = repoState(root);
  const pkg = `${bpmnDir}/package.json`;
  const local = (() => {
    try {
      const v = (JSON.parse(readFileSync(join(root, pkg), 'utf8')) as { version?: unknown }).version;
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  })();
  const base: JourneyVersions = {
    journey,
    localVersion: local,
    mainBranch: s.main,
    repo: { branch: s.branch, clean: s.clean, ahead: s.ahead, behind: s.behind, isGit: s.isGit },
    versions: [],
    unpublished: [],
    branches: [],
    seen,
    latest: local,
    newSinceSeen: [],
  };
  if (!s.isGit || !s.publishedRef) return { ...base, ...(s.isGit ? { error: 'branche principale introuvable' } : { error: 'dépôt workflow hors git : versions indisponibles' }) };

  const ref = s.publishedRef;
  const versions: PublishedVersion[] = [];
  let prev: string | null = null;
  for (const c of log(root, ref, [pkg])) {
    const v = versionAt(root, c.hash, pkg);
    const parent = versionAt(root, `${c.hash}^`, pkg);
    if (!v || v === parent) continue;
    // Commits livrés : ceux qui touchent le processus, hors commit de version lui-même (sauf le tout premier).
    const commits = log(root, prev ? `${prev}..${c.hash}` : c.hash, [bpmnDir]).filter((x) => !prev || x.hash !== c.hash);
    const localMain = s.main && exists(root, `refs/heads/${s.main}`) ? s.main : null;
    const inLocal = localMain ? git(root, ['merge-base', '--is-ancestor', c.hash, localMain]) !== null : true;
    versions.push({ version: v, commit: c.hash, date: c.date, commits, tickets: [...new Set(commits.flatMap((x) => x.tickets))], remoteOnly: !inLocal });
    prev = c.hash;
  }
  const unpublished = prev ? log(root, `${prev}..${ref}`, [bpmnDir]) : [];

  const branches: JourneyVersions['branches'] = [];
  const refs = (git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']) ?? '').split('\n').filter(Boolean);
  for (const b of refs) {
    if (b === 'origin' || b === 'origin/HEAD' || b === `origin/${s.main}`) continue;
    const commits = log(root, `${ref}..${b}`, [bpmnDir]);
    if (commits.length) branches.push({ branch: b.replace(/^origin\//, ''), commits, tickets: [...new Set(commits.flatMap((x) => x.tickets))] });
  }

  const latest = versions.at(-1)?.version ?? local;
  const newSinceSeen = versions.map((v) => v.version).filter((v) => !seen || compareVersions(v, seen) > 0);
  return { ...base, versions, unpublished, branches, latest, newSinceSeen };
}

/** Contenu du BPMN du processus à une version, un commit, ou `local` (copie de travail). */
export function bpmnAt(root: string, bpmnDir: string, at: string, versions: PublishedVersion[]): { label: string; files: string[] } {
  if (at === 'local') {
    const files = (git(root, ['ls-files', '--', bpmnDir]) ?? '').split('\n').filter((f) => f.endsWith('.bpmn'));
    return { label: 'copie locale', files: files.map((f) => readFileSync(join(root, f), 'utf8')) };
  }
  const commit = versions.find((v) => v.version === at)?.commit ?? at;
  const names = (git(root, ['ls-tree', '--name-only', commit, `${bpmnDir}/`]) ?? '').split('\n').filter((f) => f.endsWith('.bpmn'));
  if (!names.length) throw new Error(`aucun BPMN à « ${at} » dans ${bpmnDir}`);
  return { label: at, files: names.map((f) => git(root, ['show', `${commit}:${f}`]) ?? '') };
}
