import { join } from 'node:path';
import type { AsideMap } from '../../core/families';
import { readJson, safeName, writeJsonAtomic } from './dataDir';

/**
 * Décisions locales de l'utilisateur (§8, §10) : écrans écartés (avec raison)
 * et validation à la main du smoke par langue. Petits fichiers JSON.
 */

const REF = /^([A-Z][A-Z0-9_]*\.[A-Za-z0-9_]+|email:[^\s]+)$/;
const asidePath = (dir: string, id: string) => join(dir, 'aside', `${safeName(id)}.json`);
const smokePath = (dir: string, id: string) => join(dir, 'smoke', `${safeName(id)}.json`);

export const readAside = (dir: string, id: string): AsideMap => readJson<AsideMap>(asidePath(dir, id)) ?? {};
export const readSmokeValidations = (dir: string, id: string): Record<string, string> => readJson<Record<string, string>>(smokePath(dir, id)) ?? {};

export function setAside(dir: string, id: string, ref: string, reason: string | null, now = new Date()): AsideMap {
  if (!REF.test(ref)) throw new Error(`écran mal formé (GROUP.KEY ou email:<gabarit>/<variante>) : ${ref}`);
  const map = readAside(dir, id);
  if (reason === null) delete map[ref];
  else {
    if (!reason.trim()) throw new Error('une raison est obligatoire pour écarter un écran');
    map[ref] = { reason: reason.trim(), at: now.toISOString() };
  }
  writeJsonAtomic(asidePath(dir, id), map);
  return map;
}

/** `key` = `<id du chemin>|<langue>` ; `test` = titre complet du test validé, null pour retirer. */
export function setSmokeValidation(dir: string, id: string, key: string, test: string | null): Record<string, string> {
  if (!/^[^|]+\|[a-z]{2}(-[A-Z]{2})?$/.test(key)) throw new Error(`clé de smoke mal formée (<chemin>|<langue>) : ${key}`);
  const map = readSmokeValidations(dir, id);
  if (test === null) delete map[key];
  else map[key] = test;
  writeJsonAtomic(smokePath(dir, id), map);
  return map;
}
