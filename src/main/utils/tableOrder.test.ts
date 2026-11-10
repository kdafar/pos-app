import { describe, expect, it } from 'vitest';
import { compareTables } from './tableOrder';

const row = (n: number, floor?: { id: string; sort: number }) => ({
  name: `Table ${n}`,
  number: n,
  section_id: floor?.id ?? null,
  section_name_en: floor ? `Floor ${floor.id}` : null,
  section_name_ar: null,
  section_sort: floor?.sort ?? 0,
});

const names = (rows: ReturnType<typeof row>[]) =>
  [...rows].sort(compareTables).map((r) => r.name);

describe('compareTables', () => {
  it('reads digits as numbers within a floor', () => {
    const floor = { id: '2', sort: 20 };
    const seen = [11, 19, 12, 20, 21, 2, 14].map((n) => row(n, floor));
    expect(names(seen)).toEqual(
      [2, 11, 12, 14, 19, 20, 21].map((n) => `Table ${n}`)
    );
  });

  it('keeps floors in their order, with floor-less tables last', () => {
    const upper = { id: '2', sort: 20 };
    const ground = { id: '1', sort: 10 };
    expect(names([row(1), row(1, upper), row(9, ground)])).toEqual([
      'Table 9',
      'Table 1',
      'Table 1',
    ]);
    expect([row(1), row(1, upper)].sort(compareTables)[1].section_id).toBeNull();
  });
});
