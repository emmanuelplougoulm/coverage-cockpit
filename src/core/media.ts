/** Contrat des sous-commandes d'images et de croquis (§5.2, §7, §10). */

export interface CaptureUse {
  /** "GROUP.KEY" ou "email:<gabarit>/<variante>". */
  ref: string;
  locale: string;
  suite: 'ui' | 'workflow';
  test: string;
}

export interface Thumbnail {
  /** Image de référence, relative au dépôt de tests. */
  image: string;
  /** Miniature en data URL. */
  thumb: string;
  /** Empreinte du contenu (doublons de rendu). */
  hash: string;
  uses: CaptureUse[];
}

export interface ThumbnailsResult {
  journey: string;
  thumbnails: Thumbnail[];
  /** Images identiques qui montrent des écrans différents. */
  duplicates: { hash: string; images: string[]; refs: string[] }[];
}

/** Textes d'un état par langue : base du croquis d'un écran non capturé. */
export interface SketchesResult {
  journey: string;
  texts: Record<string, Record<string, Record<string, string>>>;
}
