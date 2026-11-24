import type { JourneyConfig } from '../core/journey';
import { pilot } from './pilot';

/** Identifiant du parcours pilote (fixture de non-régression). */
export const PILOT_ID = pilot.id;

/** Registre des parcours configurés. Ajouter un parcours = ajouter une ligne ici et dans `journeyFiles`. */
export const journeys: JourneyConfig[] = [pilot];

/**
 * Fichier de config de chaque parcours, relatif à l'outil : seule la config
 * du parcours entre dans son empreinte de cache (ajouter un parcours
 * n'invalide pas les autres).
 */
export const journeyFiles: Record<string, string> = {
  [pilot.id]: 'src/journeys/pilot.ts',
};
