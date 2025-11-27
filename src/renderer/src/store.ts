import { create } from 'zustand';

/* ========= Types ========= */
type Role =
  | 'admin'
  | 'Admin'
  | 'superadmin'
  | 'Super Admin'
  | 'branch'
  | 'kitchen'
  | string;
type Category = {
  id: string;
  name: string;
  name_ar?: string;
  position?: number;
  visible?: number;
};
type Subcategory = {
  id: string;
  category_id: string;
  name: string;
  name_ar?: string;
  position?: number;
  visible?: number;
};
type Item = {
  id: string;
  name: string;
  name_ar?: string;
  barcode?: string;
  has_addons?: number | boolean;
  price: number;
  is_outofstock?: number;
  category_id?: string | null;
  subcategory_id?: string | null;
};
type AddonGroup = {
  id: string;
  name: string;
  name_ar: string;
  is_required: boolean;
  max_select: number;
  addons_count: number;
};
type Addon = {
  id: string;
  group_id: string;
  name: string;
  name_ar: string;
  price: number;
};
type ActiveTab = {
  id: string;
  tab_position: number;
  number: string;
  order_type: number;
  updated_at: number;
  user_id?: string | number;
  created_by_user_id?: string | number;
};
type OrderLine = {
  id: string;
  item_id: string;
  name: string;
  name_ar?: string;
  qty: number;
  unit_price: number;
  line_total: number;
};
type Order = {
  id: string;
  number: string;
  order_type: 1 | 2 | 3;
  status: string;
  subtotal: number;
  tax_total: number;
  discount_total: number;
  delivery_fee: number;
  grand_total: number;
  user_id?: string | number;
  created_by_user_id?: string | number;
};
type CurrentUser = {
  id: string | number;
  name?: string;
  role?: Role;
  branch_id?: string | number;
} | null;

/* ========= Helpers ========= */
const api = (channel: string, ...args: any[]) =>
  window.api!.invoke(channel, ...args);

const isAdminRole = (r?: Role) =>
  !!r && ['admin', 'Admin', 'superadmin', 'Super Admin'].includes(String(r));

const toStr = (v: any) => (v == null ? '' : String(v));

const normalizeCats = (arr: any[] = []): Category[] =>
  arr.map((c) => ({ ...c, id: toStr(c.id) }));

const normalizeSubs = (arr: any[] = []): Subcategory[] =>
  arr.map((s) => ({
    ...s,
    id: toStr(s.id),
    category_id: toStr(s.category_id),
  }));

/** Try a primary IPC shape then fall back to a secondary one */
async function tryInvoke<T = any>(
  primary: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<T> {
  try {
    return await primary();
  } catch (e) {
    if (fallback) return await fallback();
    throw e;
  }
}

/* ========= Store ========= */
interface AppState {
  collapsed: boolean;
  brand: string;
  currentUser: CurrentUser;

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

    fetchWhoAmI: () => Promise<void>;
    fetchInitialData: () => Promise<void>;
    fetchAddons: (groupId: string | null) => Promise<void>;

    refreshItems: () => Promise<void>;
    refreshTabs: () => Promise<void>;
    refreshCurrent: () => Promise<void>;
    refreshPrepared: () => Promise<void>;

    newOrder: (type?: 1 | 2 | 3) => Promise<void>;
    addItem: (it: Item, qty?: number) => Promise<void>;
    setOrderType: (type: 1 | 2 | 3) => Promise<void>;
    decreaseLine: (line: OrderLine) => Promise<void>;

    setQ: (q: string) => void;
    setCatId: (id: string | null) => void;
    setSubId: (id: string | null) => void;
    setCurrentId: (id: string | null) => void;
  };
}

export const useStore = create<AppState>((set, get) => ({
  collapsed: false,
  brand: 'POS',
  currentUser: null,

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
    toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
    setBrand: (name) => set({ brand: name }),

    /* ----- whoami (renderer-safe) ----- */
    fetchWhoAmI: async () => {
      // Prefer IPC; fall back to window.pos.auth.status() if available
      let who: any = null;
      try {
        who = await api('auth:status');
      } catch {}
      if (!who && (window as any).pos?.auth?.status) {
        try {
          who = await (window as any).pos.auth.status();
        } catch {}
      }
      const user = who?.current_user || who?.user || null;
      set({
        currentUser: user
          ? {
              id: user.id,
              name: user.name,
              role: user.role,
              branch_id: user.branch_id,
            }
          : null,
      });
    },

    /* ----- initial data (cats/subs/addonGroups/items/tabs/prepared) ----- */
    fetchInitialData: async () => {
      const [c1, s1, ag] = await Promise.all([
        api('catalog:listCategories'),
        api('catalog:listSubcategories', null),
        api('catalog:listAddonGroups'),
      ]);
      console.log('[store] fetchInitialData ->', {
        cats: c1?.length ?? 0,
        subs: s1?.length ?? 0,
        addonGroups: ag?.length ?? 0,
      });
      set({ cats: c1, subs: s1, addonGroups: ag });
      await get().actions.fetchAddons(null);
      await get().actions.refreshItems();
      await get().actions.refreshTabs();
      await get().actions.refreshPrepared();
    },

    fetchAddons: async (groupId) => {
      const addons = await tryInvoke(
        () => api('catalog:listAddons', groupId),
        () => api('catalog:listAddons') // fallback API that ignores filter
      );
      set({ addons: addons || [] });
    },

    /* ----- catalog items (auto-fallback param names) ----- */
    refreshItems: async () => {
      const { q, catId, subId } = get();
      let list = await tryInvoke(
        () =>
          api('catalog:listItems', {
            q,
            categoryId: catId,
            subcategoryId: subId,
          }),
        () =>
          api('catalog:listItems', {
            q,
            category_id: catId,
            subcategory_id: subId,
          })
      );
      if (!Array.isArray(list)) list = [];
      set({ items: list });
    },

    /* ----- orders visibility: admin=all, others=mine ----- */
    refreshTabs: async () => {
      const { currentUser } = get();
      const mineOnly = !isAdminRole(currentUser?.role);

      // Try server-side filtering; if not supported, filter client-side.
      let t: ActiveTab[] = await tryInvoke(
        () => api('orders:listActive', mineOnly ? { mineOnly: true } : {}),
        () => api('orders:listActive')
      );
      if (!Array.isArray(t)) t = [];

      if (mineOnly && currentUser?.id != null) {
        const uid = String(currentUser.id);
        t = t.filter(
          (a) =>
            String(
              (a as any).created_by_user_id ?? (a as any).user_id ?? ''
            ) === uid
        );
      }

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
      const { currentUser } = get();
      const mineOnly = !isAdminRole(currentUser?.role);

      let p: any[] = await tryInvoke(
        () =>
          api(
            'orders:listPrepared',
            mineOnly ? { mineOnly: true, limit: 20 } : { limit: 20 }
          ),
        () => api('orders:listPrepared', 20) // legacy signature
      );
      if (!Array.isArray(p)) p = [];

      if (mineOnly && currentUser?.id != null) {
        const uid = String(currentUser.id);
        p = p.filter(
          (o) =>
            String(
              (o as any).created_by_user_id ?? (o as any).user_id ?? ''
            ) === uid
        );
      }

      set({ prepared: p });
    },

    /* ----- create & mutate orders (edit lock to owner/admin) ----- */
    newOrder: async (type = 2) => {
      const { currentUser } = get();
      let o = await tryInvoke(
        () => api('orders:start', { orderType: type, userId: currentUser?.id }),
        () => api('orders:start', { orderType: type })
      );
      set({ currentId: o.id });
      await get().actions.refreshTabs();
      await get().actions.refreshCurrent();
    },

    addItem: async (it, qty = 1) => {
      let { currentId, order, currentUser } = get();

      // start a new order if none active
      if (!currentId) {
        let o = await tryInvoke(
          () => api('orders:start', { orderType: 2, userId: currentUser?.id }),
          () => api('orders:start', { orderType: 2 })
        );
        set({ currentId: o.id });
        currentId = o.id;
        order = o;
      }

      // edit lock: only owner or admin can mutate
      const ownerId = String(
        (order as any)?.created_by_user_id ?? (order as any)?.user_id ?? ''
      );
      if (
        !isAdminRole(currentUser?.role) &&
        ownerId &&
        String(currentUser?.id ?? '') !== ownerId
      ) {
        console.warn('Edit denied: not owner of the order');
        return;
      }

      await api('orders:addLine', currentId, it.id, qty);
      await get().actions.refreshCurrent();
      await get().actions.refreshTabs();
    },

    setOrderType: async (type) => {
      const { currentId, order, currentUser } = get();
      if (!currentId) return;

      const ownerId = String(
        (order as any)?.created_by_user_id ?? (order as any)?.user_id ?? ''
      );
      if (
        !isAdminRole(currentUser?.role) &&
        ownerId &&
        String(currentUser?.id ?? '') !== ownerId
      ) {
        console.warn('Edit denied: not owner of the order');
        return;
      }

      await api('orders:setType', currentId, type);
      await get().actions.refreshCurrent();
      await get().actions.refreshTabs();
    },

    decreaseLine: async (line) => {
      const { currentId, order, currentUser } = get();
      if (!currentId) return;

      const ownerId = String(
        (order as any)?.created_by_user_id ?? (order as any)?.user_id ?? ''
      );
      if (
        !isAdminRole(currentUser?.role) &&
        ownerId &&
        String(currentUser?.id ?? '') !== ownerId
      ) {
        console.warn('Edit denied: not owner of the order');
        return;
      }

      await api('orders:addLine', currentId, line.item_id, -1);
      await get().actions.refreshCurrent();
    },

    /* ----- UI filters (auto-refresh items) ----- */
    setQ: (q) => {
      set({ q });
      void get().actions.refreshItems();
    },
    setCatId: (id) => {
      set({ catId: id, subId: null });
      void get().actions.refreshItems();
    },
    setSubId: (id) => {
      set({ subId: id });
      void get().actions.refreshItems();
    },
    setCurrentId: (id) => set({ currentId: id }),
  },
}));
