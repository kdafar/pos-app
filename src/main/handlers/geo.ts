// src/main/handlers/geo.ts
import type { IpcMain } from 'electron';
import db from '../db';

/**
 * Geo lookups serve two callers with opposite needs.
 *
 * The till's address pickers must only ever offer areas that can actually be
 * delivered to, so they stay active-only — that is the default here, and it is
 * what every existing caller already expects.
 *
 * Admin needs the opposite: a disabled area is precisely what someone is
 * looking for when they ask why an address cannot be selected, and it was
 * invisible. `includeInactive` opts into that.
 *
 * Every query now also SELECTs is_active. Previously they filtered on it
 * without returning it, so the column arrived undefined and rendered as
 * "Disabled" for rows the query had already guaranteed were active — the exact
 * opposite of the truth, on every row.
 */
type GeoArg =
  | string
  | null
  | undefined
  | { stateId?: string | null; cityId?: string | null; includeInactive?: boolean };

function readArg(arg: GeoArg): {
  id: string | null;
  includeInactive: boolean;
} {
  if (arg == null) return { id: null, includeInactive: false };
  if (typeof arg === 'string')
    return { id: arg === 'all' ? null : arg, includeInactive: false };
  const id = arg.stateId ?? arg.cityId ?? null;
  return {
    id: id === 'all' ? null : id,
    includeInactive: !!arg.includeInactive,
  };
}

/** `1=1` keeps the SQL shape identical whether or not the filter applies. */
const activeClause = (includeInactive: boolean) =>
  includeInactive ? '1=1' : 'is_active = 1';

export function registerGeoHandlers(ipcMain: IpcMain) {
  // ----- States -----
  ipcMain.handle('geo:listStates', async (_e, arg?: GeoArg) => {
    const { includeInactive } = readArg(arg);
    return db
      .prepare(
        `
        SELECT id, name, name_ar, is_active
        FROM states
        WHERE ${activeClause(includeInactive)}
        ORDER BY name_ar COLLATE NOCASE ASC
      `
      )
      .all();
  });

  // ----- Cities -----
  ipcMain.handle('geo:listCities', async (_e, arg?: GeoArg) => {
    const { id: stateId, includeInactive } = readArg(arg);

    if (stateId) {
      return db
        .prepare(
          `
          SELECT id, name, name_ar, state_id, min_order, delivery_fee, is_active
          FROM cities
          WHERE ${activeClause(includeInactive)} AND state_id = ?
          ORDER BY name_ar COLLATE NOCASE ASC
        `
        )
        .all(stateId);
    }

    return db
      .prepare(
        `
        SELECT id, name, name_ar, state_id, min_order, delivery_fee, is_active
        FROM cities
        WHERE ${activeClause(includeInactive)}
        ORDER BY name_ar COLLATE NOCASE ASC
      `
      )
      .all();
  });

  // ----- Blocks -----
  ipcMain.handle('geo:listBlocks', async (_e, arg?: GeoArg) => {
    const { id: cityId, includeInactive } = readArg(arg);

    if (cityId) {
      return db
        .prepare(
          `
          SELECT id, name, name_ar, city_id, is_active
          FROM blocks
          WHERE city_id = ? AND ${activeClause(includeInactive)}
          ORDER BY name_ar COLLATE NOCASE ASC
        `
        )
        .all(cityId);
    }

    return db
      .prepare(
        `
        SELECT id, name, name_ar, city_id, is_active
        FROM blocks
        WHERE ${activeClause(includeInactive)}
        ORDER BY name_ar COLLATE NOCASE ASC
      `
      )
      .all();
  });

  // ----- Single City -----
  ipcMain.handle('geo:getCity', async (_e, cityId: string) => {
    return db
      .prepare(
        `
        SELECT id, name, name_ar, min_order, delivery_fee, is_active
        FROM cities
        WHERE id = ?
      `
      )
      .get(cityId);
  });
}
