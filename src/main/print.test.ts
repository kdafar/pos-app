import { describe, expect, it } from 'vitest';
import { getReceiptPageLayout } from './receiptPageLayout';

describe('receipt page layout', () => {
  it('prints an 80mm receipt as one content-sized thermal roll page', () => {
    const layout = getReceiptPageLayout(80, 297, 900);

    expect(layout.isSheet).toBe(false);
    expect(layout.bodyWidthMm).toBe(78);
    expect(layout.heightMm).toBe(0);
    expect(layout.pageSize.width).toBe(80_000);
    expect(layout.pageSize.height).toBeGreaterThan(900 * (25400 / 96));
  });

  it('prints A4 on a full 210x297mm sheet with the receipt at top width', () => {
    const layout = getReceiptPageLayout(210, 297, 900);

    expect(layout.isSheet).toBe(true);
    expect(layout.bodyWidthMm).toBe(78);
    expect(layout.pageSize).toEqual({ width: 210_000, height: 297_000 });
  });

  it('defaults sheet height to A4 when no height was saved', () => {
    expect(getReceiptPageLayout(210, 0, 100).pageSize.height).toBe(297_000);
  });
});
