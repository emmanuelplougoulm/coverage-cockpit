import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { journeys } from '../src/journeys';
import { readBpmn } from '../src/engine/sources';
import { resolveRepos } from '../src/engine/repos';
import { loadKnowledge } from '../src/engine/knowledge/load';

/**
 * `pnpm catalog:learn` : propose des décisions réutilisables tirées des choix
 * de branches écrits dans les configs et que le catalogue ne connaît pas encore.
 * N'écrit rien sans `--write` (feu vert explicite) ; chaque entrée écrite garde
 * « why: à compléter » tant qu'un humain n'a pas donné la raison.
 */
const dir = fileURLToPath(new URL('../knowledge', import.meta.url));
const known = loadKnowledge(dir).decisions;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const proposals: Record<string, unknown>[] = [];
for (const config of journeys) {
  let bpmn;
  try {
    bpmn = readBpmn(config, resolveRepos());
  } catch (e) {
    console.error(`${config.id} : BPMN illisible (${e instanceof Error ? e.message : e}), ignoré`);
    continue;
  }
  for (const [key, links] of Object.entries(config.bpmnBranches ?? {})) {
    const b = bpmn.branches.find((x) => x.key === key);
    if (!b) continue;
    const name = b.name ?? b.flowId;
    const covered = known.some((d) => d.kind === 'branch' && new RegExp(d.event!, 'i').test(name) && (!d.subprocess || new RegExp(d.subprocess).test(b.scope.at(-1) ?? '')));
    if (covered) continue;
    const link = links.length === 0 ? 'none' : links.length === 1 ? (links[0]!.startsWith('email:') ? `email:^${esc(links[0]!.slice(6))}$` : `step:^${esc(links[0]!)}$`) : null;
    if (!link) continue; // plusieurs preuves : pas de décision générique évidente
    proposals.push({ id: `${config.id}-${b.flowId}`, kind: 'branch', event: `^${esc(name)}$`, subprocess: `^${esc(b.scope.at(-1) ?? '')}$`, links: link, why: 'à compléter', journeys: [config.id] });
  }
}
if (!proposals.length) console.log('Rien à apprendre : le catalogue couvre déjà les choix des configs.');
else {
  console.log(`${proposals.length} proposition(s) :\n\n${stringify(proposals)}`);
  if (process.argv.includes('--write')) {
    const file = `${dir}/decisions.yaml`;
    appendFileSync(file, `\n# Appris par catalog:learn le ${new Date().toISOString().slice(0, 10)} — raisons à compléter.\n${stringify(proposals)}`);
    loadKnowledge(dir); // revalide le fichier écrit
    console.log(`Écrit dans knowledge/decisions.yaml (${readFileSync(file, 'utf8').split('\n').length} lignes).`);
  } else console.log('Rien n’est écrit : relancer avec --write pour les ajouter au catalogue.');
}
