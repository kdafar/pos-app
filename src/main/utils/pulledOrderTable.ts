// src/main/utils/pulledOrderTable.ts
//
// Until the server sends table_id on /pull order rows, all we have is
// `table_name` — a text copy of the table's name. Resolve it to a local table
// of the same branch, and only when exactly one table answers to it.

export interface TableLite {
  id: string;
  label?: string | null;
  number?: number | null;
  label_ar?: string | null;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

export function matchTableByName(
  tables: TableLite[],
  name: unknown
): string | null {
  const want = norm(name);
  if (!want) return null;
  const hits = new Set<string>();
  for (const t of tables) {
    const names = [t.label, t.label_ar];
    if (t.number != null && Number(t.number) > 0) names.push(`Table ${t.number}`);
    if (names.some((n) => norm(n) === want)) hits.add(String(t.id));
  }
  return hits.size === 1 ? [...hits][0] : null;
}
