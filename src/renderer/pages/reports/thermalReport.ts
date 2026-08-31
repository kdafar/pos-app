/**
 * The closing report as it prints on a till roll.
 *
 * Deliberately NOT the A4 document scaled down — thirteen landscape columns
 * are unreadable at 80mm — but a Z-report: the figures a cashier reads out at
 * close, in one fluid column.
 *
 * Two rules make this safe to add next to receipts, labels and the A4 report:
 *
 *  1. Nothing here states a page size, a body width or a paper length. Sizing
 *     belongs to the main process, which applies the till's configured roll
 *     width and measures the page length off the rendered content — the same
 *     path every receipt takes. `thermalReport.test.ts` asserts this document
 *     declares no size of its own, because a stray `@page { size: ... }` here
 *     would silently override that for this document and nothing else.
 *  2. Every value arrives already formatted and already translated. This module
 *     lays out; the page decides what the words and the money look like.
 */

export type ThermalRow = {
  label: string;
  value: string;
  /** A cancelled order, struck through so it cannot be read as a sale. */
  cancelled?: boolean;
};

export type ThermalReportInput = {
  dir: 'ltr' | 'rtl';
  /** CSS font stack; the page picks it, because it knows the language. */
  font: string;
  title: string;
  branchName: string;
  /** The day or range the figures cover. */
  rangeLabel: string;
  /** The exact operational window, which a preset range does not show. */
  windowLabel: string;
  generatedAt: string;
  generatedBy: string;
  labels: {
    generatedAt: string;
    generatedBy: string;
    counts: string;
    inside: string;
    outside: string;
    cancelled: string;
    totalOrders: string;
    payments: string;
    orderTypes: string;
    items: string;
    categories: string;
    orders: string;
    signature: string;
  };
  counts: { inside: string; outside: string; cancelled: string; total: string };
  payments: ThermalRow[];
  orderTypes: ThermalRow[];
  /** What was sold, per product and per category — the same two report tabs. */
  items: ThermalRow[];
  categories: ThermalRow[];
  orders: ThermalRow[];
  /** Four already-formatted lines: gross, discounts, delivery, net. */
  totals: ThermalRow[];
};

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const row = (r: ThermalRow, cls = '') =>
  `<div class="row ${r.cancelled ? 'void' : ''} ${cls}"><span class="l">${esc(
    r.label
  )}</span><span class="v">${esc(r.value)}</span></div>`;

const section = (title: string, body: string) =>
  body
    ? `<div class="sec"><div class="st">${esc(title)}</div>${body}</div>`
    : '';

export function buildThermalReportHtml(input: ThermalReportInput): string {
  // Every order, however long the roll gets. A capped list was tried and
  // rejected: a closing report that quietly stops after N orders is a report
  // whose bottom the cashier cannot tell is missing, and the roll is where
  // this shop signs off the day.
  const orders = input.orders.map((o) => row(o)).join('');

  const counts = [
    `<div class="metric"><span>${esc(input.labels.inside)}</span><b>${esc(input.counts.inside)}</b></div>`,
    `<div class="metric"><span>${esc(input.labels.outside)}</span><b>${esc(input.counts.outside)}</b></div>`,
    `<div class="metric"><span>${esc(input.labels.cancelled)}</span><b>${esc(input.counts.cancelled)}</b></div>`,
    `<div class="metric total"><span>${esc(input.labels.totalOrders)}</span><b>${esc(input.counts.total)}</b></div>`,
  ].join('');

  const totals = input.totals
    .map((line, i) => row(line, i === input.totals.length - 1 ? 'net' : ''))
    .join('');

  return `<!doctype html><html dir="${input.dir}"><head><meta charset="utf-8">
<title>${esc(input.title)}</title><style>
  @media print { @page { margin: 0 } }
  /* No width and no page size: the main process sets the body width from the
     till's paper setting and derives the page length from this content. */
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #000; font: 11.5px/1.35 ${input.font}; }
  /* The main process already keeps the body inside the roll. This inner gutter
     protects text from thermal heads whose printable area is narrower still. */
  .wrap { padding: 2.5mm 2mm 5mm; }
  .c { text-align: center; }
  .brand { font-size: 9px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
  h1 { margin: 2px 0 4px; font-size: 18px; line-height: 1.15; }
  .branch { font-size: 13px; font-weight: 700; margin: 0 0 3px; }
  .sub { font-size: 10.5px; margin: 0 0 1px; }
  .rule { border-top: 2px solid #000; margin: 7px 0 5px; }
  .meta { padding-bottom: 2px; }
  .sec { margin-top: 8px; break-inside: avoid; }
  .st { display: flex; align-items: center; gap: 5px; font-weight: 800;
        font-size: 10.5px; text-transform: uppercase; letter-spacing: .35px;
        margin-bottom: 3px; white-space: nowrap; }
  .st::after { content: ''; border-top: 1px solid #000; flex: 1; }
  .row { display: flex; justify-content: space-between; gap: 6px;
         align-items: baseline; padding: 2px 0; }
  .row .l { flex: 1 1 auto; word-break: break-word; }
  .row .v { flex: 0 0 auto; font-variant-numeric: tabular-nums;
            white-space: nowrap; font-weight: 700; direction: ltr; unicode-bidi: isolate; }
  .metrics { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; }
  .metric { min-width: 0; padding: 5px 4px; text-align: center; border-bottom: 1px solid #000; }
  .metric:nth-child(odd) { border-inline-end: 1px solid #000; }
  .metric:nth-last-child(-n+2) { border-bottom: 0; }
  .metric span { display: block; font-size: 9px; line-height: 1.2; }
  .metric b { display: block; margin-top: 2px; font-size: 17px; line-height: 1; }
  .metric.total { background: #000; color: #fff; }
  .orders .row { border-bottom: 1px dotted #777; }
  .orders .row:last-child { border-bottom: 0; }
  .row.void { color: #555; }
  .row.void .l, .row.void .v { text-decoration: line-through; }
  .totals { border: 1.5px solid #000; padding: 3px 5px; }
  .row.net { font-weight: 800; font-size: 15px; border-top: 2px solid #000;
             margin-top: 3px; padding: 5px 0 2px; }
  .sign { margin-top: 14px; font-size: 10px; }
  .sign .line { border-bottom: 1px solid #000; height: 18px; margin-top: 4px; }
  .foot { margin-top: 8px; padding-top: 4px; border-top: 1px dashed #000;
          font-size: 9px; letter-spacing: .6px; text-align: center; }
</style></head><body><div class="wrap">
  <div class="c">
    <div class="brand">MAJESTIC POS</div>
    <h1>${esc(input.title)}</h1>
    <p class="branch">${esc(input.branchName)}</p>
    <p class="sub">${esc(input.rangeLabel)}</p>
    <p class="sub">${esc(input.windowLabel)}</p>
  </div>
  <div class="rule"></div>
  <div class="meta">
    ${row({ label: input.labels.generatedAt, value: input.generatedAt })}
    ${row({ label: input.labels.generatedBy, value: input.generatedBy })}
  </div>
  ${section(input.labels.counts, `<div class="metrics">${counts}</div>`)}
  ${section(input.labels.payments, input.payments.map((p) => row(p)).join(''))}
  ${section(
    input.labels.orderTypes,
    input.orderTypes.map((o) => row(o)).join('')
  )}
  ${section(
    input.labels.categories,
    input.categories.map((c) => row(c)).join('')
  )}
  ${section(input.labels.items, input.items.map((i) => row(i)).join(''))}
  ${section(
    input.labels.orders,
    orders ? `<div class="orders">${orders}</div>` : ''
  )}
  <div class="sec totals">${totals}</div>
  <div class="sign">${esc(
    input.labels.signature
  )}<div class="line"></div></div>
  <p class="foot">END OF REPORT</p>
</div></body></html>`;
}
