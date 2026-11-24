import { fileURLToPath } from 'node:url';

/** Racines du corpus anonymisé (trois mini-dépôts). */
export const CORPUS = {
  workflow: fileURLToPath(new URL('../fixtures/corpus/workflow', import.meta.url)),
  front: fileURLToPath(new URL('../fixtures/corpus/front', import.meta.url)),
  e2e: fileURLToPath(new URL('../fixtures/corpus/e2e', import.meta.url)),
};
