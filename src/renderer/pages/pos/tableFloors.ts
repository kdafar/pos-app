import type { TableInfo } from './types';

export type Floor = { key: string; nameEn: string; nameAr: string };

/** Key for tables with no floor; never a real section id. */
export const NO_FLOOR = '__none__';

/**
 * The floors present in a table list, in the order the list arrives — the main
 * process already sorts tables by floor. Tables with no floor become one
 * trailing "Other" group, and only when some tables do have a floor: a branch
 * that has not set up floors sees no tabs at all.
 */
export function floorsOf(tables: TableInfo[]): Floor[] {
  const floors: Floor[] = [];
  const seen = new Set<string>();
  let hasNone = false;
  for (const t of tables) {
    if (!t.section_id) {
      hasNone = true;
      continue;
    }
    if (seen.has(t.section_id)) continue;
    seen.add(t.section_id);
    floors.push({
      key: t.section_id,
      nameEn: t.section_name_en || t.section_name_ar || '',
      nameAr: t.section_name_ar || t.section_name_en || '',
    });
  }
  if (floors.length && hasNone) floors.push({ key: NO_FLOOR, nameEn: '', nameAr: '' });
  return floors;
}

export function onFloor(t: TableInfo, key: string): boolean {
  return key === NO_FLOOR ? !t.section_id : t.section_id === key;
}

/** The floor to open on: the one holding the order's table, else the first. */
export function initialFloor(
  floors: Floor[],
  tables: TableInfo[],
  tableId?: string | null
): string {
  const seated = tableId ? tables.find((t) => t.id === tableId) : undefined;
  if (seated) return seated.section_id || NO_FLOOR;
  return floors[0]?.key ?? NO_FLOOR;
}
