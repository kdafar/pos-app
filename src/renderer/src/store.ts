import { create } from 'zustand';

// Define the types for your state
type Category = { id: string; name: string; name_ar?: string; position?: number; visible?: number };
type Subcategory = { id:string; category_id:string; name:string; name_ar?:string; position?:number; visible?:number };
type Item = { id: string; name: string; name_ar?: string; barcode?: string; price: number; is_outofstock?: number; category_id?: string|null; subcategory_id?: string|null };
type AddonGroup = { id: string; name: string; name_ar: string; is_required: boolean; max_select: number; addons_count: number };
type Addon = { id: string; group_id: string; name: string; name_ar: string; price: number };
type ActiveTab = { id: string; tab_position: number; number: string; order_type: number; updated_at: number };
type OrderLine = { id: string; item_id: string; name: string; name_ar?: string; qty: number; unit_price: number; line_total: number };
type Order = {
  id: string; number: string; order_type: 1|2|3; status: string;
  subtotal: number; tax_total: number; discount_total: number; delivery_fee: number; grand_total: number;
};

// Define the state structure
interface AppState {
  collapsed: boolean;
  brand: string;
  cats: Category[];
  subs: Subcategory[];
  items: Item[];
  addonGroups: AddonGroup[];
  addons: Addon[];
  q: string;
  catId: string | null;
  subId: string | null;
  tabs: ActiveTab[];
  currentId: string | null;
  order: Order | null;
  lines: OrderLine[];
  prepared: any[];
  actions: {
    toggleCollapsed: () => void;
    setBrand: (name: string) => void;
    fetchInitialData: () => Promise<void>;
    fetchAddons: (groupId: string | null) => Promise<void>;
    refreshItems: () => Promise<void>;
    refreshTabs: () => Promise<void>;
    refreshCurrent: () => Promise<void>;
    refreshPrepared: () => Promise<void>;
    newOrder: (type?: 1|2|3) => Promise<void>;
    addItem: (it: Item, qty?: number) => Promise<void>;
    setOrderType: (type: 1|2|3) => Promise<void>;
    decreaseLine: (line: OrderLine) => Promise<void>;
    setQ: (q: string) => void;
    setCatId: (id: string | null) => void;
    setSubId: (id: string | null) => void;
    setCurrentId: (id: string | null) => void;
  };
}

const api = (channel: string, ...args: any[]) => window.api!.invoke(channel, ...args);

export const useStore = create<AppState>((set, get) => ({
  collapsed: false,
  brand: 'POS',
  cats: [],
  subs: [],
  items: [],
  addonGroups: [],
  addons: [],
  q: '',
  catId: null,
  subId: null,
  tabs: [],
  currentId: null,
  order: null,
  lines: [],
  prepared: [],
  actions: {
    toggleCollapsed: () => set(state => ({ collapsed: !state.collapsed })),
    setBrand: (name: string) => set({ brand: name }),
    fetchInitialData: async () => {
      const [c1, s1, ag] = await Promise.all([
        api('catalog:listCategories'),
        api('catalog:listSubcategories', null),
        api('catalog:listAddonGroups'),
      ]);
      set({ cats: c1, subs: s1, addonGroups: ag });
      await get().actions.fetchAddons(null);
      await get().actions.refreshItems();
      await get().actions.refreshTabs();
      await get().actions.refreshPrepared();
    },
    fetchAddons: async (groupId) => {
      const addons = await api('catalog:listAddons', groupId);
      set({ addons });
    },
    refreshItems: async () => {
      const { q, catId, subId } = get();
      const list = await api('catalog:listItems', { q, categoryId: catId, subcategoryId: subId });
      set({ items: list });
    },
    refreshTabs: async () => {
      const t = await api('orders:listActive');
      set({ tabs: t });
      if (!get().currentId && t.length) {
        set({ currentId: t[0].id });
        const got = await api('orders:get', t[0].id);
        set({ order: got.order, lines: got.lines });
      }
    },
    refreshCurrent: async () => {
      const { currentId } = get();
      if (!currentId) return;
      const got = await api('orders:get', currentId);
      set({ order: got.order, lines: got.lines });
    },
    refreshPrepared: async () => {
      const p = await api('orders:listPrepared', 20);
      set({ prepared: p });
    },
    newOrder: async (type = 2) => {
      const o = await api('orders:start', { orderType: type });
      set({ currentId: o.id });
      await get().actions.refreshTabs();
      await get().actions.refreshCurrent();
    },
    addItem: async (it, qty = 1) => {
      let { currentId } = get();
      if (!currentId) {
        const o = await api('orders:start', { orderType: 2 });
        set({ currentId: o.id });
        currentId = o.id;
      }
      await api('orders:addLine', currentId, it.id, qty);
      await get().actions.refreshCurrent();
      await get().actions.refreshTabs();
    },
    setOrderType: async (type) => {
      const { currentId } = get();
      if (!currentId) return;
      await api('orders:setType', currentId, type);
      await get().actions.refreshCurrent();
      await get().actions.refreshTabs();
    },
    decreaseLine: async (line) => {
      const { currentId } = get();
      if (!currentId) return;
      await api('orders:addLine', currentId, line.item_id, -1);
      await get().actions.refreshCurrent();
    },
    setQ: (q) => set({ q }),
    setCatId: (id) => set({ catId: id }),
    setSubId: (id) => set({ subId: id }),
    setCurrentId: (id) => set({ currentId: id }),
  }
}));