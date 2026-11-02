// The font every printed page carries with it.
//
// Many thermal-printer drivers (POS-80 and its clones) have a "font
// substitution table": text in a system font such as Arial is not drawn but
// sent as plain characters for the printer to print in its own built-in font.
// When the driver's code page and the printer disagree, English receipts come
// out as garbage — while Arabic, which no built-in font can stand in for, is
// drawn as an image and prints perfectly. A font the page brings itself is no
// system font, so the driver has nothing to substitute and draws it like the
// Arabic.
//
// The embedded face takes the names of every Latin font our print templates
// ask for, limited to Latin characters. Arabic text falls through to the
// system fonts exactly as before.

import { RECEIPT_FONT_WOFF2 } from './receiptFont.generated';

// Every name a thermal template lists before its generic fallback. Each one
// adds a copy of the font to the page, so only names in actual use.
const FAMILIES = ['Open Sans', 'Arial', 'Segoe UI', 'Tahoma'];

// The latin subset's own coverage (from @fontsource/open-sans).
const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

let css: string | null = null;

function fontCss(): string {
  if (css) return css;
  const faces: string[] = [];
  for (const family of FAMILIES) {
    for (const [weight, data] of Object.entries(RECEIPT_FONT_WOFF2)) {
      faces.push(
        `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
          `font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');` +
          `unicode-range:${LATIN_RANGE};}`
      );
    }
  }
  css = `<style id="pos-embedded-font">${faces.join('')}</style>`;
  return css;
}

/** The page with the embedded font added to its <head>. */
export function withEmbeddedFont(html: string): string {
  if (html.includes('id="pos-embedded-font"')) return html;
  const head = /<head[^>]*>/i.exec(html);
  if (!head) return fontCss() + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + fontCss() + html.slice(at);
}
