import type { IpcMain } from 'electron';
import db from '../db';

type CatalogListItemsFilter = {
  q?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
};

type AddonGroupFilter = {
  itemId?: string;
};

type AddonFilter = {
  groupId?: string;
};

function log(...args: any[]) {
  console.log('[ipc:catalog]', ...args);
}

export function registerCatalogHandlers(ipcMain: IpcMain) {
  // 🔍 Search items by name / barcode
  ipcMain.handle('catalog:search', async (_e, q: string) => {
    // FIX: Added image and image_local here
    const stmt = db.prepare(
      `
  SELECT
    i.id,
    i.name,
    i.name_ar,
    i.barcode,
    i.price,
    i.is_outofstock,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM item_addon_groups iag
        WHERE iag.item_id = i.id
      ) THEN 1
      ELSE 0
    END AS has_addons,
    i.image,
    i.image_local
  FROM items i
  WHERE i.name LIKE ? OR i.name_ar LIKE ? OR i.barcode = ?
  LIMIT 50
`
    );

    return stmt.all(`%${q}%`, `%${q}%`, q);
  });

  // 📂 List categories
  ipcMain.handle('catalog:listCategories', () => {
    try {
      const rows = db
        .prepare(
          `
          SELECT id, name, name_ar, position, visible
          FROM categories
          ORDER BY COALESCE(position,0) ASC, LOWER(COALESCE(name,'')) ASC
        `
        )
        .all();
      log('listCategories ->', rows.length);
      return rows;
    } catch (e) {
      log('listCategories ERROR', e);
      return [];
    }
  });

  // 🧾 List items (with optional search/category/subcategory filters)
  ipcMain.handle(
    'catalog:listItems',
    async (_e, filter: CatalogListItemsFilter | null = null) => {
      const where: string[] = [];
      const params: any[] = [];

      if (filter?.q) {
        where.push(`(name LIKE ? OR name_ar LIKE ? OR barcode = ?)`);
        const q = filter.q.trim();
        params.push(`%${q}%`, `%${q}%`, q);
      }
      if (filter?.categoryId) {
        where.push(`category_id = ?`);
        params.push(filter.categoryId);
      }
      if (filter?.subcategoryId) {
        where.push(`subcategory_id = ?`);
        params.push(filter.subcategoryId);
      }

      // FIX: Added image and image_local here
      const sql = `
  SELECT
    i.id,
    i.name,
    i.name_ar,
    i.barcode,
    i.price,
    i.is_outofstock,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM item_addon_groups iag
        WHERE iag.item_id = i.id
      ) THEN 1
      ELSE 0
    END AS has_addons,
    i.updated_at,
    i.category_id,
    i.subcategory_id,
    i.image,
    i.image_local
  FROM items i
  ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  ORDER BY i.name COLLATE NOCASE ASC
  LIMIT 500
`;

      return db.prepare(sql).all(...params);
    }
  );

  // 📂 List subcategories (optionally by category)
  ipcMain.handle(
    'catalog:listSubcategories',
    (_e, categoryId?: string | null) => {
      try {
        const rows = categoryId
          ? db
              .prepare(
                `
                SELECT id, category_id, name, name_ar, position, visible
                FROM subcategories
                WHERE category_id = ?
                ORDER BY COALESCE(position,0), LOWER(COALESCE(name,''))
              `
              )
              .all(String(categoryId))
          : db
              .prepare(
                `
                SELECT id, category_id, name, name_ar, position, visible
                FROM subcategories
                ORDER BY COALESCE(position,0), LOWER(COALESCE(name,''))
              `
              )
              .all();

        log('listSubcategories ->', rows.length, 'cat:', categoryId ?? 'ALL');
        return rows;
      } catch (e) {
        log('listSubcategories ERROR', e);
        return [];
      }
    }
  );

  // 🎟 List active promos
  ipcMain.handle('catalog:listPromos', async () => {
    try {
      const now = Date.now();
      return db
        .prepare(
          `
          SELECT id, code, type, value, min_total, max_discount, start_at, end_at
          FROM promos
          WHERE active = 1
            AND (start_at IS NULL OR start_at <= ?)
            AND (end_at   IS NULL OR end_at   >   ?)
          ORDER BY code ASC
        `
        )
        .all(now, now);
    } catch (e: any) {
      console.error('Failed to list promos:', e.message);
      return [];
    }
  });

  // ➕ List addon groups (optionally for a given item)
  ipcMain.handle(
    'catalog:listAddonGroups',
    async (_e, filter: AddonGroupFilter | null = null) => {
      try {
        if (filter?.itemId) {
          // Groups for a specific item
          return db
            .prepare(
              `
              SELECT ag.id, ag.name, ag.name_ar, iag.is_required, iag.max_select
              FROM addon_groups ag
              JOIN item_addon_groups iag ON iag.group_id = ag.id
              WHERE iag.item_id = ?
              ORDER BY ag.name ASC
            `
            )
            .all(filter.itemId);
        }

        // All groups
        return db
          .prepare(
            `
            SELECT id, name, name_ar, is_required, max_select
            FROM addon_groups
            ORDER BY name ASC
          `
          )
          .all();
      } catch (e: any) {
        console.error(
          'Failed to list addon groups, tables might be missing:',
          e.message
        );
        return [];
      }
    }
  );

  // ➕ List addons (optionally for a given group)
  ipcMain.handle(
    'catalog:listAddons',
    async (_e, filter: AddonFilter | null = null) => {
      try {
        if (filter?.groupId) {
          return db
            .prepare(
              `
              SELECT id, group_id, name, name_ar, price
              FROM addons
              WHERE group_id = ?
              ORDER BY name ASC
            `
            )
            .all(filter.groupId);
        }

        return db
          .prepare(
            `
            SELECT id, group_id, name, name_ar, price
            FROM addons
            ORDER BY group_id ASC, name ASC
          `
          )
          .all();
      } catch (e: any) {
        console.error(
          'Failed to list addons, table might be missing:',
          e.message
        );
        return [];
      }
    }
  );
}
