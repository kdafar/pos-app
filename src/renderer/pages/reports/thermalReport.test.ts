import { describe, expect, it } from 'vitest';
import {
  buildThermalReportHtml,
  type ThermalReportInput,
} from './thermalReport';

const labels: ThermalReportInput['labels'] = {
  generatedAt: 'Printed at',
  generatedBy: 'Printed by',
  counts: 'Order counts',
  inside: 'Inside Hours',
  outside: 'Outside Hours',
  cancelled: 'Cancelled Orders',
  totalOrders: 'Total orders',
  payments: 'By Payment',
  orderTypes: 'By Order Type',
  items: 'By Item',
  categories: 'By Category',
  orders: 'Orders',
  signature: 'Cashier signature',
};

function makeInput(over: Partial<ThermalReportInput> = {}): ThermalReportInput {
  return {
    dir: 'ltr',
    font: '"Open Sans",Arial,sans-serif',
    title: 'Closing Report',
    branchName: 'Salmiya',
    rangeLabel: '2026-08-31',
    windowLabel: '31/08 08:00 — 31/08 23:59',
    generatedAt: '31/08 23:59',
    generatedBy: 'Cashier 1',
    labels,
    counts: { inside: '12', outside: '3', cancelled: '1', total: '16' },
    payments: [{ label: 'Cash', value: '120.500' }],
    orderTypes: [{ label: 'Dine-in ×4', value: '60.000' }],
    items: [{ label: '2× Baklava', value: '12.000' }],
    categories: [{ label: '3× Oriental Sweets', value: '12.000' }],
    orders: [{ label: '1. A-101', value: '10.000' }],
    totals: [
      { label: 'Gross', value: '130.000' },
      { label: 'Discounts', value: '- 5.000' },
      { label: 'Delivery', value: '2.000' },
      { label: 'Net', value: '127.000' },
    ],
    ...over,
  };
}

const ordersOfLength = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    label: `${i + 1}. A-${i + 1}`,
    value: '1.000',
  }));

describe('thermal closing report', () => {
  /**
   * The whole point of routing this through the receipt path: the roll width
   * and the page length are the main process's business. A size declared here
   * would override it for this document alone — the exact "one print size
   * broke another" fault this document was added without causing.
   */
  it('declares no page size, paper width or length of its own', () => {
    const html = buildThermalReportHtml(makeInput());

    expect(html).not.toMatch(/@page\s*{[^}]*size/i);
    expect(html).not.toMatch(/body\s*{[^}]*width/i);
    expect(html).toContain('@page { margin: 0 }');
  });

  /**
   * The roll is where this shop signs off the day, so it carries the same
   * orders the A4 does — no cap, no truncation. A list that quietly stopped
   * after N orders would look complete on paper.
   */
  it('prints every order, however long the list is', () => {
    const html = buildThermalReportHtml(
      makeInput({ orders: ordersOfLength(200) })
    );

    expect(html).toContain('1. A-1<');
    expect(html).toContain('200. A-200<');
    expect((html.match(/class="row/g) || []).length).toBeGreaterThanOrEqual(200);
  });

  it('strikes cancelled orders through so they cannot read as sales', () => {
    const html = buildThermalReportHtml(
      makeInput({
        orders: [
          { label: '1. A-101', value: '10.000' },
          { label: '2. A-102', value: '4.000', cancelled: true },
        ],
      })
    );

    expect(html).toMatch(/class="row\s+void[^"]*">.*A-102/);
    expect(html).not.toMatch(/class="row\s+void[^"]*">.*A-101/);
  });

  it('carries the Arabic direction through to the document', () => {
    const html = buildThermalReportHtml(
      makeInput({
        dir: 'rtl',
        font: '"Tajawal",Tahoma,sans-serif',
        title: 'تقرير الإغلاق',
        labels: { ...labels, signature: 'توقيع الكاشير' },
      })
    );

    expect(html).toContain('<html dir="rtl">');
    expect(html).toContain('charset="utf-8"');
    expect(html).toContain('"Tajawal",Tahoma,sans-serif');
    expect(html).toContain('تقرير الإغلاق');
    expect(html).toContain('توقيع الكاشير');
  });

  it('escapes customer and branch text instead of letting it close a tag', () => {
    const html = buildThermalReportHtml(
      makeInput({
        branchName: 'A & B <script>alert(1)</script>',
        orders: [{ label: '1. <b>x</b>', value: '1.000' }],
      })
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('A &amp; B &lt;script&gt;');
    expect(html).toContain('1. &lt;b&gt;x&lt;/b&gt;');
  });

  it('drops a section entirely when the report has no rows for it', () => {
    const html = buildThermalReportHtml(
      makeInput({ payments: [], orderTypes: [], orders: [] })
    );

    expect(html).not.toContain('By Payment');
    expect(html).not.toContain('By Order Type');
    expect(html).not.toContain('Orders</div>');
    expect(html).toContain('Order counts');
  });

  it('emphasises the net total as the last totals line', () => {
    const html = buildThermalReportHtml(makeInput());

    expect(html).toMatch(/class="row\s*(?:\s)*net">.*Net.*127\.000/);
  });

  it('uses a scannable closing-report hierarchy on the roll', () => {
    const html = buildThermalReportHtml(makeInput());

    expect(html).toContain('class="brand"');
    expect(html).toContain('class="metrics"');
    expect(html).toContain('class="metric total"');
    expect(html).toContain('class="orders"');
    expect(html).toContain('class="sec totals"');
    expect(html).toContain('END OF REPORT');
  });

  /**
   * The roll carries the same two breakdowns the screen does. A cashier
   * closing the day off the printed report should not have to go back to a
   * screen to see what was actually sold.
   */
  it('prints the item and category breakdowns', () => {
    const html = buildThermalReportHtml(makeInput());

    expect(html).toContain('By Category');
    expect(html).toContain('3× Oriental Sweets');
    expect(html).toContain('By Item');
    expect(html).toContain('2× Baklava');
  });

  it('omits either breakdown when the report has no rows for it', () => {
    const html = buildThermalReportHtml(makeInput({ items: [], categories: [] }));

    expect(html).not.toContain('By Category');
    expect(html).not.toContain('By Item');
    // The figures that always matter are still there.
    expect(html).toContain('Total orders');
    expect(html).toContain('127.000');
  });
});
