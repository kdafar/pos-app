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

type VariationFilter = {
  itemId?: string;
};

function log(...args: any[]) {
  console.log('[ipc:catalog]', ...args);
}

/** Max rows catalog:listItems will return. Pair with catalog:countItems. */
export const ITEM_LIST_LIMIT = 500;

/**
 * Shared WHERE builder so listItems and countItems can never disagree about
 * what "matching" means — a mismatch would show a bogus "showing X of Y".
 */
function buildItemFilter(filter: CatalogListItemsFilter | null) {
  const where: string[] = [];
  const params: any[] = [];

  const q = filter?.q?.trim();

  if (q) {
    where.push(`(name LIKE ? OR name_ar LIKE ? OR barcode = ?)`);
    params.push(`%${q}%`, `%${q}%`, q);
  }

  // A search deliberately ignores the selected category.
  //
  // Combining the two meant a cashier who had tapped a category and then
  // searched got "no items found" for something the shop plainly sells — the
  // item was simply filed elsewhere. Nothing on screen explained why, so the
  // usual recovery was to retype the search rather than clear the category.
  // Browsing is scoped; searching is not.
  if (!q) {
    if (filter?.categoryId) {
      where.push(`category_id = ?`);
      params.push(filter.categoryId);
    }
    if (filter?.subcategoryId) {
      where.push(`subcategory_id = ?`);
      params.push(filter.subcategoryId);
    }
  }

  return { where, params };
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
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM variations v
        WHERE v.item_id = i.id
      ) THEN 1
      ELSE 0
    END AS has_variations,
    (
      SELECT MIN(
        CASE
          WHEN v.sale_price IS NOT NULL AND v.sale_price > 0 THEN v.sale_price
          WHEN v.price      IS NOT NULL AND v.price      > 0 THEN v.price
          ELSE COALESCE(i.price, 0)
        END
      )
      FROM variations v
      WHERE v.item_id = i.id
    ) AS min_variation_price,
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
      const { where, params } = buildItemFilter(filter);

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
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM variations v
        WHERE v.item_id = i.id
      ) THEN 1
      ELSE 0
    END AS has_variations,
    (
      SELECT MIN(
        CASE
          WHEN v.sale_price IS NOT NULL AND v.sale_price > 0 THEN v.sale_price
          WHEN v.price      IS NOT NULL AND v.price      > 0 THEN v.price
          ELSE COALESCE(i.price, 0)
        END
      )
      FROM variations v
      WHERE v.item_id = i.id
    ) AS min_variation_price,
    i.updated_at,
    i.category_id,
    i.subcategory_id,
    i.image,
    i.image_local
  FROM items i
  ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  ORDER BY i.name COLLATE NOCASE ASC
  LIMIT ${ITEM_LIST_LIMIT}
`;

      const rows = db.prepare(sql).all(...params);
      if (rows.length === ITEM_LIST_LIMIT) {
        log(
          `listItems hit the ${ITEM_LIST_LIMIT}-row cap — renderer should warn the operator`
        );
      }
      return rows;
    }
  );

  // 🔢 True number of items matching a filter, so the UI can tell the operator
  // when the grid is truncated instead of silently hiding products.
  ipcMain.handle(
    'catalog:countItems',
    async (_e, filter: CatalogListItemsFilter | null = null) => {
      try {
        const { where, params } = buildItemFilter(filter);
        const row = db
          .prepare(
            `SELECT COUNT(*) AS total FROM items i ${
              where.length ? 'WHERE ' + where.join(' AND ') : ''
            }`
          )
          .get(...params) as { total?: number };

        return { total: Number(row?.total ?? 0), limit: ITEM_LIST_LIMIT };
      } catch (e) {
        log('countItems ERROR', e);
        return { total: 0, limit: ITEM_LIST_LIMIT };
      }
    }
  );

  // 🔎 Exact barcode lookup for scanner input. Deliberately exact-match and
  // LIMIT-free, unlike catalog:search — a scan must resolve to one product.
  ipcMain.handle('catalog:findByBarcode', async (_e, code: string) => {
    try {
      const raw = String(code ?? '').trim();
      if (!raw) return null;

      return (
        db
          .prepare(
            `
            SELECT
              i.id, i.name, i.name_ar, i.barcode, i.price, i.is_outofstock,
              i.category_id, i.subcategory_id, i.image, i.image_local,
              CASE WHEN EXISTS (
                SELECT 1 FROM item_addon_groups iag WHERE iag.item_id = i.id
              ) THEN 1 ELSE 0 END AS has_addons,
              CASE WHEN EXISTS (
                SELECT 1 FROM variations v WHERE v.item_id = i.id
              ) THEN 1 ELSE 0 END AS has_variations,
              (
                SELECT MIN(
                  CASE
                    WHEN v.sale_price IS NOT NULL AND v.sale_price > 0 THEN v.sale_price
                    WHEN v.price      IS NOT NULL AND v.price      > 0 THEN v.price
                    ELSE COALESCE(i.price, 0)
                  END
                ) FROM variations v WHERE v.item_id = i.id
              ) AS min_variation_price
            FROM items i
            WHERE i.barcode = ?
            LIMIT 1
          `
          )
          .get(raw) ?? null
      );
    } catch (e) {
      log('findByBarcode ERROR', e);
      return null;
    }
  });

  // 📂 List subcategories (optionally by category)
  ipcMain.handle(
    'catalog:listSubcategories',
    (_e, categoryId?: string | null) => {
      try {
        // Orphans — subcategories whose parent category does not exist — can
        // never be reached by tapping a category, but they rendered anyway
        // whenever "All Categories" was selected. This install has two named
        // "All" pointing at category 0, which showed up beside the grid's own
        // All control and read as a duplicate.
        //
        // Guarded on the categories table being populated: if the catalog has
        // not synced yet, show everything rather than an empty filter bar.
        const notOrphan = `
          AND (
            NOT EXISTS (SELECT 1 FROM categories)
            OR EXISTS (
              SELECT 1 FROM categories c
              WHERE CAST(c.id AS TEXT) = CAST(s.category_id AS TEXT)
            )
          )`;

        const rows = categoryId
          ? db
              .prepare(
                `
                SELECT s.id, s.category_id, s.name, s.name_ar, s.position, s.visible
                FROM subcategories s
                WHERE CAST(s.category_id AS TEXT) = CAST(? AS TEXT)
                ${notOrphan}
                ORDER BY COALESCE(s.position,0), LOWER(COALESCE(s.name,''))
              `
              )
              .all(String(categoryId))
          : db
              .prepare(
                `
                SELECT s.id, s.category_id, s.name, s.name_ar, s.position, s.visible
                FROM subcategories s
                WHERE 1=1
                ${notOrphan}
                ORDER BY COALESCE(s.position,0), LOWER(COALESCE(s.name,''))
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

  // 🍟 List variations (sizes/options) for an item
  ipcMain.handle(
    'catalog:listVariations',
    async (_e, filter: VariationFilter | string | null = null) => {
      try {
        // Accept both listVariations('123') and listVariations({ itemId: '123' })
        const itemId =
          typeof filter === 'string' ? filter : filter?.itemId ?? null;
        if (!itemId) return [];

        return db
          .prepare(
            `
            SELECT
              v.id,
              v.item_id,
              v.name,
              v.name_ar,
              v.price,
              v.sale_price,
              -- Effective price the POS will charge. Must stay in sync with
              -- variationEffectivePrice() in handlers/orders.ts, otherwise the
              -- picker shows one price and the line is rung up at another.
              CASE
                WHEN v.sale_price IS NOT NULL AND v.sale_price > 0 THEN v.sale_price
                WHEN v.price      IS NOT NULL AND v.price      > 0 THEN v.price
                ELSE COALESCE(i.price, 0)
              END AS effective_price
            FROM variations v
            JOIN items i ON i.id = v.item_id
            WHERE v.item_id = ?
            ORDER BY effective_price ASC, v.name COLLATE NOCASE ASC
          `
          )
          .all(String(itemId));
      } catch (e: any) {
        console.error(
          'Failed to list variations, table might be missing:',
          e.message
        );
        return [];
      }
    }
  );

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
