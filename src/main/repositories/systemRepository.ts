import db from '../db';

export const SystemRepo = {
  listPaymentMethods() {
    return db.prepare(`SELECT id,slug,name_en,name_ar,legacy_code,is_active,sort_order,updated_at
                       FROM payment_methods ORDER BY sort_order`).all();
  },

  listStates() {
    return db.prepare(`SELECT id,name,name_ar,is_active,updated_at
                       FROM states ORDER BY name`).all();
  },

  listCities() {
    return db.prepare(`SELECT id,state_id,name,name_ar,min_order,delivery_fee,is_active,updated_at
                       FROM cities ORDER BY name`).all();
  },

  listBlocks() {
    return db.prepare(`SELECT id,city_id,name,name_ar,is_active,updated_at
                       FROM blocks ORDER BY name`).all();
  },
};
