// src/main/handlers/geo.ts
import type { IpcMain } from 'electron';
import db from '../db';

export function registerGeoHandlers(ipcMain: IpcMain) {
  // ----- States -----
  ipcMain.handle('geo:listStates', async () => {
    return db
      .prepare(
        `
        SELECT id, name, name_ar
        FROM states
        WHERE is_active = 1
        ORDER BY name_ar COLLATE NOCASE ASC
      `
      )
      .all();
  });

  // ----- Cities -----
  ipcMain.handle('geo:listCities', async (_e, stateId?: string | null) => {
    if (stateId) {
      return db
        .prepare(
          `
          SELECT id, name, name_ar, min_order, delivery_fee
          FROM cities
          WHERE is_active = 1 AND state_id = ?
          ORDER BY name_ar COLLATE NOCASE ASC
        `
        )
        .all(stateId);
    }

    return db
      .prepare(
        `
        SELECT id, name, state_id, name_ar, min_order, delivery_fee
        FROM cities
        WHERE is_active = 1
        ORDER BY name_ar COLLATE NOCASE ASC
      `
      )
      .all();
  });

  // ----- Blocks -----
  ipcMain.handle('geo:listBlocks', async (_e, cityId?: string | null) => {
    if (cityId && cityId !== 'all') {
      return db
        .prepare(
          `
          SELECT id, name, name_ar, city_id, is_active
          FROM blocks
          WHERE city_id = ? AND is_active = 1
          ORDER BY name_ar COLLATE NOCASE ASC
        `
        )
        .all(cityId);
    }

    // no cityId → return all active blocks
    return db
      .prepare(
        `
        SELECT id, name, name_ar, city_id, is_active
        FROM blocks
        WHERE is_active = 1
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
        SELECT id, name, name_ar, min_order, delivery_fee
        FROM cities
        WHERE id = ?
      `
      )
      .get(cityId);
  });
}
