/** Petits utilitaires de géométrie pour les graphiques SVG faits main. */

export const linear = (d0: number, d1: number, r0: number, r1: number) => (v: number) =>
  d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

/** Barre verticale ancrée à la ligne de base, bout de donnée arrondi (4 px). */
export function vBar(x: number, y: number, w: number, base: number, r = 4): string {
  const h = base - y;
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${base}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${base}Z`;
}

/** Barre horizontale ancrée à gauche, bout de donnée arrondi. */
export function hBar(x0: number, y: number, x1: number, h: number, r = 4): string {
  const w = x1 - x0;
  if (w <= 0) return '';
  const rr = Math.min(r, h / 2, w);
  return `M${x0},${y}H${x1 - rr}Q${x1},${y} ${x1},${y + rr}V${y + h - rr}Q${x1},${y + h} ${x1 - rr},${y + h}H${x0}Z`;
}

/** Graduations « rondes » de 0 à max. */
export function ticks(max: number, count = 4, integer = false): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  if (integer) step = Math.max(1, Math.round(step));
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out.at(-1)! < max) out.push(out.at(-1)! + step);
  return out;
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);
export const dateFr = (iso: string, withTime = false) =>
  new Date(iso).toLocaleString('fr-FR', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { day: '2-digit', month: 'short' });
