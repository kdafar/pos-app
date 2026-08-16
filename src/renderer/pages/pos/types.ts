// types.ts
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

export interface OrderLine {
  id: string;
  order_id: string;
  item_id: string;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
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

export interface Promo {
  id: string;
  code: string;
  type: string; // 'percent' | 'amount' etc.
  value: number;
  min_total: number;
  max_discount?: number;
  active?: number | boolean;
}

export interface Customer {
  full_name: string;
  mobile: string;
  email?: string;
  address?: string;
}

// Shared item/category types

export interface Item {
  id: string;
  name: string;
  name_ar: string;
  barcode: string;
  price: number;
  is_outofstock: number;
  has_addons?: number | boolean;
  has_variations?: number | boolean;
  /** Cheapest variation price, when the item is sold by variation. */
  min_variation_price?: number | null;
  category_id: string;
  subcategory_id: string;
  image?: string | null;
  image_local?: string | null;
}

export interface Variation {
  id: string;
  item_id: string;
  name: string;
  name_ar?: string | null;
  price?: number | null;
  sale_price?: number | null;
  /** sale_price when > 0, else price, else the item price (computed in main) */
  effective_price: number;
}

export interface Category {
  id: string | number;
  name: string;
  name_ar: string;
  category_id?: string | number;
}

export interface AddonGroup {
  id: string;
  name: string;
  name_ar?: string | null;
  /** From item_addon_groups — SQLite gives 0/1, older payloads gave '1'/true. */
  is_required?: number | boolean | string | null;
  max_select?: number | null;
}

export interface Addon {
  id: string;
  group_id: string;
  name: string;
  name_ar?: string | null;
  price: number;
}

export type SelectedAddon = {
  id: string;
  group_id: string;
  qty: number;
};

/** What the item-options modal hands back to the order page. */
export type ItemSelection = {
  variation_id: string | null;
  addons: SelectedAddon[];
  /** Number of this exact configuration to add. */
  qty: number;
};
