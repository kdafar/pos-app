// Text size, chosen per device in Settings (like the language).
//
// Only font sizes change — every Tailwind and HeroUI text size and the POS
// screen's own scale are multiplied by --ui-text-scale (styles/tailwind.css),
// so spacing and layout stay as designed. A host shell may also set
// --ui-text-boost (the Android build does on small tablets, where it scales the
// whole page down to fit); the two multiply.
//
// Set inline on <html>: unlike the theme colours this value is the same in
// light and dark, so there is no .dark rule it would have to outrank.

export type TextScaleId = 'small' | 'normal' | 'large' | 'xlarge';

export const TEXT_SCALES: ReadonlyArray<{ id: TextScaleId; value: number }> = [
  { id: 'small', value: 0.9 },
  { id: 'normal', value: 1 },
  { id: 'large', value: 1.1 },
  { id: 'xlarge', value: 1.2 },
];

const STORE_KEY = 'ui.text_scale';

export function normalizeTextScale(v: unknown): TextScaleId {
  return TEXT_SCALES.some((s) => s.id === v) ? (v as TextScaleId) : 'normal';
}

export function applyTextScale(id: TextScaleId) {
  const value = TEXT_SCALES.find((s) => s.id === id)?.value ?? 1;
  document.documentElement.style.setProperty('--ui-text-scale', String(value));
  document.documentElement.dataset.textScale = id;
}

/** Before first paint, so the till never flashes the wrong size. Never rejects. */
export async function loadTextScale(): Promise<TextScaleId> {
  let id: TextScaleId = 'normal';
  try {
    id = normalizeTextScale(await (window as any).api?.invoke('store:get', STORE_KEY));
  } catch {
    /* keep normal */
  }
  applyTextScale(id);
  return id;
}

export async function saveTextScale(id: TextScaleId) {
  applyTextScale(id);
  await (window as any).api?.invoke('store:set', STORE_KEY, id);
}
