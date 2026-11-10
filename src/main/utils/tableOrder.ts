type TableRow = {
  name?: unknown;
  number: number;
  section_id?: unknown;
  section_name_en?: unknown;
  section_name_ar?: unknown;
  section_sort?: unknown;
};

const floorRank = (r: TableRow) =>
  r.section_name_en || r.section_name_ar ? Number(r.section_sort) || 0 : Infinity;

/**
 * Floor by floor (tables with no floor last), then by name with digits read as
 * numbers: Table 2 before Table 10.
 *
 * The server's table sort_order is deliberately not used. Tables added later
 * share a value with older ones, which put Table 19 between 11 and 12.
 */
export function compareTables(a: TableRow, b: TableRow): number {
  const fa = floorRank(a);
  const fb = floorRank(b);
  return (
    (fa === fb ? 0 : fa - fb) ||
    String(a.section_id ?? '').localeCompare(String(b.section_id ?? '')) ||
    String(a.name ?? '').localeCompare(String(b.name ?? ''), 'en', { numeric: true }) ||
    a.number - b.number
  );
}
