import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKnowledge } from '../src/engine/knowledge/load';
import { onboard, survey } from '../src/engine/onboard';
import { resolveRepos } from '../src/engine/repos';
import { dataDir } from '../src/engine/store/dataDir';
import { journeys } from '../src/journeys';

/**
 * `pnpm onboard <processus>` : brouillon de config + rapport dans le dossier de
 * données (jamais dans un dépôt). `pnpm onboard:survey` : processus non configurés.
 */
const repos = resolveRepos();
if (process.argv.includes('--survey')) {
  const s = survey(repos, journeys);
  for (const p of s) console.log(`${p.configured ? '✓' : '·'} ${p.process.padEnd(32)} ${p.file}`);
  console.log(`\n${s.filter((p) => !p.configured).length} processus non configuré(s).`);
} else {
  const id = process.argv[2];
  if (!id) {
    console.error('usage : pnpm onboard <processus>');
    process.exit(2);
  }
  const knowledge = loadKnowledge(fileURLToPath(new URL('../knowledge', import.meta.url)));
  const r = onboard(id, repos, journeys.find((j) => j.id === id), knowledge);
  const dir = join(dataDir(), 'onboarding-drafts', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'brouillon.ts'), r.draft);
  writeFileSync(join(dir, 'rapport.md'), r.report);
  console.log(`${r.points.length} point(s) à trancher.\nBrouillon : ${join(dir, 'brouillon.ts')}\nRapport   : ${join(dir, 'rapport.md')}`);
}
