import db from '../db';

export const DineinRepo = {
  listTables() {
    return db.prepare(`SELECT id,branch_id,label,number,capacity,is_available,updated_at
                       FROM tables ORDER BY number`).all();
  },
};
