import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoInfo, RepoKey } from '../../core/contract';
import { caseKeyOf, parseCaseDraft, type CaseLink, type CaseRow, type CaseStatus } from '../../core/cases';
import type { CoverageView } from '../../core/coverage';
import { ownGitRoot } from '../agents/branch';
import { git } from '../store/fingerprint';
import { readJson, writeJsonAtomic } from '../store/dataDir';
import { caseClient, caseFolder } from './client';

/** Cas de test d'un parcours : lecture, création sur clic, clé dans le test, états. */

const linksPath = (dir: string) => join(dir, 'aio-links.json');
export const readLinks = (dir: string): Record<string, CaseLink> => readJson<Record<string, CaseLink>>(linksPath(dir)) ?? {};

export async function caseRows(dataDir: string, views: CoverageView[]): Promise<CaseRow[]> {
  const links = readLinks(dataDir);
  const client = caseClient(dataDir);
  const rows: CaseRow[] = [];
  for (const v of views) {
    for (const t of v.tests) {
      const tagKey = caseKeyOf(v.testTags[t.id] ?? []);
      const link = links[t.id] ?? (tagKey && tagKey !== 'TODO' ? { test: t.id, journey: v.journey, key: tagKey, inTest: true } : null);
      let status: CaseRow['status'] = null;
      if (link) {
        try {
          const c = await client.getCase(link.key);
          status = c ? c.status : 'n’existe plus';
        } catch {
          status = null; // outil non branché : état inconnu
        }
      }
      rows.push({ test: t.id, file: t.file, line: t.line, tagKey, link, status });
    }
  }
  return rows;
}

/** Crée le cas à partir du brouillon de l'agent, joint les captures des étapes. Sur clic seulement. */
export async function pushCase(
  dataDir: string,
  repos: Record<RepoKey, RepoInfo>,
  view: CoverageView,
  testId: string,
  draftText: string,
): Promise<CaseLink & { attachments: number }> {
  const links = readLinks(dataDir);
  if (links[testId]) throw new Error(`ce test est déjà lié au cas ${links[testId]!.key} : un cas déjà lié n'est pas réécrit`);
  const draft = parseCaseDraft(draftText);
  if (!draft) throw new Error('brouillon illisible : un bloc json { title, steps[] } est attendu');
  const tags = view.testTags[testId] ?? [];
  const client = caseClient(dataDir);
  const key = await client.createCase(caseFolder(view.journey, tags), draft, tags.filter((t) => !/-TC-/.test(t)));
  // Captures jointes aux étapes qui les nomment.
  const images = view.sessions.flatMap((s) => s.states.flatMap((st) => Object.values(st.byLocale).flatMap((c) => c.capturedBy.filter((x) => x.id === testId && x.image))));
  let attached = 0;
  for (const [i, step] of draft.steps.entries()) {
    if (!step.rendering) continue;
    const img = images.find((x) => x.shot?.replace(/\.png$/, '').startsWith(step.rendering) || x.image!.includes(`/${step.rendering}`));
    if (img?.image) {
      await client.attach(key, i, join(repos.e2e.path, img.image));
      attached++;
    }
  }
  const link: CaseLink = { test: testId, journey: view.journey, key, inTest: false };
  links[testId] = link;
  writeJsonAtomic(linksPath(dataDir), links);
  return { ...link, attachments: attached };
}

export async function setCaseStatus(dataDir: string, keys: string[], status: CaseStatus): Promise<{ keys: string[]; status: CaseStatus }> {
  if (!keys.length) throw new Error('aucun cas');
  await caseClient(dataDir).setStatus(keys, status);
  return { keys, status };
}

export async function linkRequirement(dataDir: string, key: string, issue: string): Promise<{ key: string; issue: string }> {
  await caseClient(dataDir).linkRequirement(key, issue);
  return { key, issue };
}

/**
 * Écrit la clé dans le test : remplace `@<PROJ>-TC-TODO` sur la ligne du test,
 * sinon ajoute la clé au titre du test. Jamais dans un describe : il couvrirait
 * d'autres tests (un cas par test). Aperçu toujours ; commit seulement si le
 * dossier de tests est son propre dépôt git, propre, hors branche principale.
 */
export function writeKey(repos: Record<RepoKey, RepoInfo>, file: string, line: number, key: string, apply: boolean): { before: string; after: string; committed: string | null; reason?: string } {
  const path = join(repos.e2e.path, file);
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const idx = /@[A-Z][A-Z0-9]*-TC-TODO\b/.test(lines[line - 1]!) ? line - 1 : -1;
  const before = lines[line - 1]!;
  const after =
    idx >= 0
      ? before.replace(/@[A-Z][A-Z0-9]*-TC-TODO\b/, `@${key}`)
      : before.replace(/\btest(\.\w+)?\((['`"])(.*?)\2/, (_m, mod: string | undefined, q: string, t: string) => `test${mod ?? ''}(${q}${t} @${key}${q}`);
  if (after === before) return { before, after, committed: null, reason: 'titre du test introuvable sur sa ligne : clé à ajouter à la main' };
  if (!apply) return { before, after, committed: null };
  if (!ownGitRoot(repos.e2e.path)) return { before, after, committed: null, reason: 'dossier de tests hors de son propre dépôt git : aperçu seulement' };
  const branch = git(repos.e2e.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'])?.trim();
  if (!branch || ['main', 'master'].includes(branch)) return { before, after, committed: null, reason: 'sur la branche principale : passer sur la branche de campagne d’abord' };
  if ((git(repos.e2e.path, ['status', '--porcelain', '--', file]) ?? '').trim()) return { before, after, committed: null, reason: 'le fichier a des modifications non commitées' };
  lines[idx >= 0 ? idx : line - 1] = after;
  writeFileSync(path, lines.join('\n'));
  git(repos.e2e.path, ['add', '--', file]);
  git(repos.e2e.path, ['commit', '--quiet', '-m', `Lie le test au cas ${key}`]);
  return { before, after, committed: git(repos.e2e.path, ['rev-parse', '--short', 'HEAD'])?.trim() ?? null };
}
