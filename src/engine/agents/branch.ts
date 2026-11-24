import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import type { BranchChoice, RunKind } from '../../core/agents';
import { git, isGitTree } from '../store/fingerprint';
import { mainBranchOf } from '../versions/history';

/**
 * Choix de branche au lancement (§13) : rester (jamais sur la principale ni en
 * HEAD détachée) ou une nouvelle branche (clé du ticket de campagne, éditable ;
 * base = branche du parcours sinon principale rafraîchie).
 */

const exists = (root: string, ref: string) => git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;

/** Noms toujours tenus pour la branche principale, même quand git ne peut pas le dire (dépôt sans commit). */
const PRINCIPAL = new Set(['main', 'master']);

/**
 * Le dossier de tests doit être LA racine de son propre dépôt : sinon (sous-dossier
 * d'un autre dépôt, comme le corpus dans l'outil) aucune branche ni aucun commit.
 */
export function ownGitRoot(dir: string): string | null {
  if (!isGitTree(dir)) return null;
  const top = git(dir, ['rev-parse', '--show-toplevel'])?.trim();
  if (!top) return null;
  try {
    return realpathSync(top) === realpathSync(dir) ? top : null;
  } catch {
    return null;
  }
}

export function branchChoice(e2e: string, journey: string, kind: RunKind, campaignKey: string | null, now = new Date()): BranchChoice {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const proposedName = campaignKey ?? `cc/${kind}-${journey}-${date}`;
  if (!ownGitRoot(e2e)) {
    const top = isGitTree(e2e) ? git(e2e, ['rev-parse', '--show-toplevel'])?.trim() : null;
    const reason = top ? `le dossier de tests est dans un autre dépôt git (${top})` : 'dépôt de tests hors git';
    return { isGit: false, current: { branch: null, canStay: false, sameJourney: false, dirty: false, reason }, proposed: { name: proposedName, base: '', refreshMain: false } };
  }
  const main = mainBranchOf(e2e);
  const branch = git(e2e, ['symbolic-ref', '--quiet', '--short', 'HEAD'])?.trim() || null;
  const dirty = (git(e2e, ['status', '--porcelain']) ?? '').trim() !== '';
  const isPrincipal = (b: string) => b === main || PRINCIPAL.has(b);
  const canStay = !!branch && !isPrincipal(branch);
  const base = exists(e2e, `refs/heads/${proposedName}`) ? proposedName : main && exists(e2e, `refs/remotes/origin/${main}`) ? `origin/${main}` : (main ?? 'HEAD');
  return {
    isGit: true,
    current: {
      branch,
      canStay,
      sameJourney: !!branch && (campaignKey ? branch === campaignKey : branch.includes(journey)),
      dirty,
      ...(!branch ? { reason: 'HEAD détachée' } : isPrincipal(branch) ? { reason: `branche principale (${branch})` } : {}),
    },
    // Rafraîchir la principale n'a de sens qu'avec un dépôt distant.
    proposed: { name: proposedName, base, refreshMain: !!main && (git(e2e, ['remote']) ?? '').split('\n').includes('origin') },
  };
}

/**
 * Prépare la branche avant le premier tour. Ne change jamais de branche si le
 * dépôt n'est pas propre : on reste, et l'agent en est averti.
 */
export function prepareBranch(e2e: string, choice: BranchChoice, want: { stay: boolean; name?: string }): { branch: string | null; notes: string[] } {
  if (!choice.isGit) return { branch: null, notes: [`${choice.current.reason ?? 'dépôt de tests hors git'} : aucune branche, aucun commit — ne rien committer`] };
  const notes: string[] = [];
  if (want.stay || choice.current.dirty) {
    if (!choice.current.canStay) {
      throw new Error(
        choice.current.dirty
          ? `modifications non commitées sur ${choice.current.reason ?? 'la branche courante'} : les committer ou les mettre de côté avant de lancer`
          : `impossible de rester sur ${choice.current.reason ?? 'cette branche'}`,
      );
    }
    if (choice.current.dirty) notes.push(`le dépôt a des modifications non commitées de l'utilisateur sur ${choice.current.branch} : ne pas les écraser ni les committer`);
    return { branch: choice.current.branch, notes };
  }
  const name = (want.name ?? choice.proposed.name).trim();
  if (!/^[\w./-]+$/.test(name) || name.startsWith('-')) throw new Error(`nom de branche refusé : ${name}`);
  const main = mainBranchOf(e2e);
  if (name === main || PRINCIPAL.has(name)) throw new Error('jamais la branche principale');
  if (choice.proposed.refreshMain) {
    try {
      execFileSync('git', ['-C', e2e, 'fetch', '--quiet', 'origin'], { timeout: 30_000, stdio: 'ignore' });
    } catch {
      notes.push('fetch impossible : branche coupée depuis la principale locale');
    }
  }
  const exists = git(e2e, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]) !== null;
  const base = exists ? null : git(e2e, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${main}`]) !== null ? `origin/${main}` : (main ?? 'HEAD');
  const ok = exists ? git(e2e, ['switch', '--quiet', name]) : git(e2e, ['switch', '--quiet', '--no-track', '-c', name, base!]);
  if (ok === null) throw new Error(`impossible de passer sur la branche ${name}`);
  return { branch: name, notes };
}
