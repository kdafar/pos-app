import db from '../db';

export type ItemRow = {
  id: string; category_id?: string|null; subcategory_id?: string|null;
  name: string; name_ar?: string|null; barcode?: string|null;
  price: number; is_outofstock?: number; updated_at?: string|null;
};

export const CatalogRepo = {
  // upserts from /bootstrap payloads
  upsertCategories(rows: any[]) {
    const stmt = db.prepare(`
      INSERT INTO categories (id,name,name_ar,position,visible,updated_at)
      VALUES (@id,@name,@name_ar,COALESCE(@position,0),CASE WHEN @visible THEN 1 ELSE 0 END,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, name_ar=excluded.name_ar, position=excluded.position,
        visible=excluded.visible, updated_at=excluded.updated_at
    `);
    const tx = db.transaction((rs: any[]) => rs.forEach(r => stmt.run(r)));
    tx(rows);
  },

  upsertSubcategories(rows: any[]) {
    const stmt = db.prepare(`
      INSERT INTO subcategories (id,category_id,name,name_ar,position,visible,updated_at)
      VALUES (@id,@category_id,@name,@name_ar,COALESCE(@position,0),CASE WHEN @visible THEN 1 ELSE 0 END,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        category_id=excluded.category_id, name=excluded.name, name_ar=excluded.name_ar,
        position=excluded.position, visible=excluded.visible, updated_at=excluded.updated_at
    `);
    const tx = db.transaction((rs: any[]) => rs.forEach(r => stmt.run(r)));
    tx(rows);
  },

  upsertItems(rows: ItemRow[]) {
    const stmt = db.prepare(`
      INSERT INTO items (id,category_id,subcategory_id,name,name_ar,barcode,price,is_outofstock,updated_at)
      VALUES (@id,@category_id,@subcategory_id,@name,@name_ar,@barcode,@price,COALESCE(@is_outofstock,0),@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        category_id=excluded.category_id, subcategory_id=excluded.subcategory_id,
        name=excluded.name, name_ar=excluded.name_ar, barcode=excluded.barcode,
        price=excluded.price, is_outofstock=excluded.is_outofstock, updated_at=excluded.updated_at
    `);
    const tx = db.transaction((rs: ItemRow[]) => rs.forEach(r => stmt.run(r)));
    tx(rows);
  },

  listCategories() {
    return db.prepare(`SELECT id,name,name_ar,position,visible,updated_at
                       FROM categories WHERE visible=1 ORDER BY position, name`).all();
  },

  listSubcategories(categoryId?: string) {
    if (categoryId) {
      return db.prepare(`SELECT * FROM subcategories
                         WHERE visible=1 AND category_id=? ORDER BY position, name`).all(categoryId);
    }
    return db.prepare(`SELECT * FROM subcategories WHERE visible=1 ORDER BY position, name`).all();
  },

  listItems(filter?: { q?: string|null; categoryId?: string|null; subcategoryId?: string|null }) {
    const where: string[] = [];
    const params: any[] = [];
    if (filter?.q) {
      where.push(`(name LIKE ? OR name_ar LIKE ? OR barcode = ?)`);
      params.push(`%${filter.q}%`, `%${filter.q}%`, filter.q);
    }
    if (filter?.categoryId) { where.push(`category_id = ?`); params.push(filter.categoryId); }
    if (filter?.subcategoryId) { where.push(`subcategory_id = ?`); params.push(filter.subcategoryId); }

    const sql = `
      SELECT id,name,name_ar,barcode,price,is_outofstock
      FROM items
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY name
    `;
    return db.prepare(sql).all(...params);
  },
};
