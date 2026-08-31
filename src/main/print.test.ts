import { describe, expect, it } from 'vitest';
import { getReceiptPageLayout } from './receiptPageLayout';
import { isPrintCancellation } from './printOutcome';

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

describe('print outcome', () => {
  it('reads the Chromium cancel reason as a cancellation, not a fault', () => {
    expect(isPrintCancellation('cancelled', true)).toBe(true);
    expect(isPrintCancellation('Print job canceled by user', true)).toBe(true);
    expect(isPrintCancellation('Job aborted', true)).toBe(true);
  });

  /**
   * A driver that says nothing after the dialog was dismissed must not be
   * announced as a printer fault — and a silent print that says nothing must
   * not have a real fault swallowed, because nobody was there to cancel it.
   */
  it('treats an empty reason as a cancellation only when a dialog was shown', () => {
    expect(isPrintCancellation('', true)).toBe(true);
    expect(isPrintCancellation(undefined, true)).toBe(true);
    expect(isPrintCancellation('', false)).toBe(false);
    expect(isPrintCancellation(null, false)).toBe(false);
  });

  it('still reports real printer failures', () => {
    expect(isPrintCancellation('Invalid deviceName provided', true)).toBe(false);
    expect(isPrintCancellation('Printer is out of paper', false)).toBe(false);
  });
});
