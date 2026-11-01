import { describe, expect, it } from 'vitest';
import { floorsOf, initialFloor, NO_FLOOR, onFloor } from './tableFloors';
import type { TableInfo } from './types';

const table = (id: string, section?: string): TableInfo => ({
  id,
  name: `Table ${id}`,
  seats: 4,
  status: 'available',
  section_id: section ?? null,
  section_name_en: section ? `Floor ${section}` : null,
  section_name_ar: null,
});

describe('table floors', () => {
  it('shows no tabs for a branch that has not set up floors', () => {
    expect(floorsOf([table('1'), table('2')])).toEqual([]);
  });

  it('keeps floors in arrival order and puts floor-less tables last', () => {
    const floors = floorsOf([table('1', 'g'), table('2', 'u'), table('3'), table('4', 'g')]);
    expect(floors.map((f) => f.key)).toEqual(['g', 'u', NO_FLOOR]);
    // An English-only floor still has a name in Arabic.
    expect(floors[0].nameAr).toBe('Floor g');
  });

  it('opens on the floor holding the order, else the first', () => {
    const tables = [table('1', 'g'), table('2', 'u'), table('3')];
    const floors = floorsOf(tables);
    expect(initialFloor(floors, tables, '2')).toBe('u');
    expect(initialFloor(floors, tables, '3')).toBe(NO_FLOOR);
    expect(initialFloor(floors, tables, null)).toBe('g');
  });

  it('files floor-less tables under the "Other" tab only', () => {
    expect(onFloor(table('3'), NO_FLOOR)).toBe(true);
    expect(onFloor(table('1', 'g'), NO_FLOOR)).toBe(false);
    expect(onFloor(table('1', 'g'), 'g')).toBe(true);
  });
});
