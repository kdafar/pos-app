const MICRONS_PER_PX = 25400 / 96;
const AUTO_HEIGHT_TAIL_MICRONS = 5_000;

/** Pure sizing rules shared by printing and local regression tests. */
export function getReceiptPageLayout(
  widthMm: number,
  configuredHeightMm: number,
  contentPx: number
) {
  const isSheet = widthMm >= 120;
  const heightMm = isSheet ? configuredHeightMm || 297 : 0;
  return {
    isSheet,
    bodyWidthMm: isSheet ? 78 : widthMm > 30 ? widthMm - 2 : widthMm,
    heightMm,
    pageSize: {
      width: Math.round(widthMm * 1000),
      height: heightMm
        ? Math.round(heightMm * 1000)
        : Math.max(
            Math.ceil(contentPx * MICRONS_PER_PX) + AUTO_HEIGHT_TAIL_MICRONS,
            50_000
          ),
    },
  };
}
