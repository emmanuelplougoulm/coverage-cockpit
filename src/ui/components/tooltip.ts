import { reactive } from 'vue';

/** Infobulle unique de l'app : suit la souris, lignes de texte (jamais de HTML). */
export const tip = reactive({ visible: false, x: 0, y: 0, lines: [] as string[] });

export function showTip(e: MouseEvent | FocusEvent, lines: string[]): void {
  const target = e.currentTarget as Element | null;
  const r = target?.getBoundingClientRect();
  const x = 'clientX' in e ? e.clientX : (r?.right ?? 0);
  const y = 'clientY' in e ? e.clientY : (r?.top ?? 0);
  Object.assign(tip, { visible: true, x: Math.min(x + 14, window.innerWidth - 330), y: y + 14, lines });
}

export function hideTip(): void {
  tip.visible = false;
}
