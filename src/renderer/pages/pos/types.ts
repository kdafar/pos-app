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
  type: string;       // 'percent' | 'amount' etc.
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
  category_id: string;
  subcategory_id: string;
  image?: string | null;
  image_local?: string | null;
}

export interface Category {
  id: string | number;
  name: string;
  name_ar: string;
  category_id?: string | number;
}
