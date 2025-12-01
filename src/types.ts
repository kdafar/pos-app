/* ========= Types ========= */
export interface Item {
  id: string;
  name: string;
  name_ar: string;
  barcode: string;
  price: number;
  image?: string | null;
  image_local?: string | null;
  is_outofstock: number;
  has_addons?: number | boolean;
  category_id: string;
  subcategory_id: string;
}
export interface Category {
  id: string;
  name: string;
  name_ar: string;
  category_id?: string;
}
export interface OrderLine {
  id: string;
  order_id: string;
  item_id: string;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;

  // NEW (optional, all nullable in DB)
  variation?: string | null;
  variation_price?: number | null;
  addons_name?: string | null; // e.g. "Cheese, Bacon"
  addons_price?: string | null; // raw text/JSON from backend (if you need later)
  addons_qty?: string | null; // same
  notes?: string | null;
}

export type OrderType = 1 | 2 | 3;
export interface Order {
  id: string;
  number: string;
  order_type: OrderType;
  status: string;
  subtotal: number;
  discount_total: number;
  delivery_fee: number;
  grand_total: number;
  opened_at: number;
  table_id?: string | null;
  table_name?: string | null;
  covers?: number | null;
  promocode?: string;
}
export type TableStatus = 'available' | 'occupied' | 'reserved';
export interface TableInfo {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  current_order_id?: string | null;
}
export interface State {
  id: string;
  name: string;
  name_ar: string;
}
export interface City {
  id: string;
  state_id: string;
  name: string;
  name_ar: string;
  delivery_fee: number;
  min_order: number;
}
export interface Block {
  id: string;
  city_id: string;
  name: string;
  name_ar: string;
}
export interface Customer {
  full_name: string;
  mobile: string;
  email?: string;
  address?: string;
}
export interface Promo {
  id: string;
  code: string;
  type: string;
  value: number;
  min_total: number;
  max_discount?: number;
  active: boolean;
}

// Addon group & addon types
export type AddonGroup = {
  id: string;
  name: string;
  name_ar?: string;
  is_required: number | boolean;
  max_select: number | null;
};

export type Addon = {
  id: string;
  group_id: string;
  name: string;
  name_ar?: string;
  price: number;
};

// Selected addon (per group)
export type SelectedAddon = {
  id: string;
  group_id: string;
  qty: number;
};

/* ========== Global declarations ========== */
declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
    };
  }
}
