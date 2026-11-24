import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeWorkflowHistory } from '../fixtures/corpus/tools/workflowHistory';

/**
 * Prépare le dépôt workflow git du corpus dans `.cc-corpus-git/` (ignoré par
 * git). Idempotent ; `--reset` le recrée (après un « Rafraîchir » qui l'a avancé).
 */
const root = fileURLToPath(new URL('../.cc-corpus-git', import.meta.url));
if (process.argv.includes('--reset') || !existsSync(`${root}/workflow/.git`)) {
  makeWorkflowHistory(root);
  if (!process.argv.includes('--quiet')) console.error(`dépôt workflow du corpus prêt : ${root}/workflow`);
}
