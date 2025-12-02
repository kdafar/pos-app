import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from 'react';
import {
  Item,
  Category,
  Order,
  OrderLine,
  TableInfo,
  State,
  City,
  Block,
  Promo,
  OrderType,
} from '../types';
import { useToast } from '../renderer/components/ToastProvider';

// Define the shape of the context state
interface OrderContextType {
  items: Item[];
  categories: Category[];
  subcategories: Category[];
  activeOrders: Order[];
  currentOrder: Order | null;
  orderLines: OrderLine[];
  tables: TableInfo[];
  states: State[];
  cities: City[];
  blocks: Block[];
  promos: Promo[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategoryId: string | null;
  setSelectedCategoryId: (id: string | null) => void;
  selectedSubcategoryId: string | null;
  setSelectedSubcategoryId: (id: string | null) => void;
  filteredSubcategories: Category[];
  ui: {
    showCheckout: boolean;
    showTablePicker: boolean;
    showPromoDialog: boolean;
  };
  actions: {
    loadItems: () => Promise<void>;
    loadActiveOrders: () => Promise<void>;
    selectOrder: (orderId: string) => Promise<void>;
    createNewOrder: (orderType?: OrderType) => Promise<void>;
    changeOrderType: (type: OrderType) => Promise<void>;
    addItemToOrder: (item: Item, qty?: number) => Promise<void>;
    applyPromoCode: (code: string) => Promise<void>;
    removePromoCode: () => Promise<void>;
    loadTables: () => Promise<void>;
    assignTable: (t: TableInfo, covers: number) => Promise<void>;
    clearTable: () => Promise<void>;
    loadCities: (stateId: string) => Promise<void>;
    loadBlocks: (cityId: string) => Promise<void>;
    openCheckout: () => void;
    closeCheckout: () => void;
    openTablePicker: () => void;
    closeTablePicker: () => void;
    openPromoDialog: () => void;
    closePromoDialog: () => void;
  };
}

const OrderContext = createContext<OrderContextType | undefined>(undefined);

export const OrderProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Data
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Category[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);

  // UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null
  );
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<
    string | null
  >(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showPromoDialog, setShowPromoDialog] = useState(false);

  const toast = useToast();

  // Initial Load
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [cats, subs, sts, prms] = await Promise.all([
          window.api.invoke('catalog:listCategories'),
          window.api.invoke('catalog:listSubcategories'),
          window.api.invoke('geo:listStates'),
          window.api.invoke('catalog:listPromos'),
        ]);
        setCategories(cats || []);
        setSubcategories(subs || []);
        setStates(sts || []);
        setPromos(prms || []);
        await Promise.all([loadItems(), loadActiveOrders()]);
      } catch (e) {
        console.error(e);
      }
    };
    loadInitialData();
  }, []);

  // Actions
  const loadItems = async () => {
    try {
      const filter = {
        q: searchQuery || null,
        categoryId: selectedCategoryId,
        subcategoryId: selectedSubcategoryId,
      };
      setItems((await window.api.invoke('catalog:listItems', filter)) || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadActiveOrders = async () => {
    try {
      const orders = await window.api.invoke('orders:listActive');
      setActiveOrders(orders || []);
      if (orders?.length && !currentOrder) {
        await selectOrder(orders[0].id);
      } else if (orders.length === 0) {
        setCurrentOrder(null);
        setOrderLines([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const selectOrder = async (orderId: string) => {
    try {
      const { order, lines } = await window.api.invoke('orders:get', orderId);
      setCurrentOrder(order);
      setOrderLines(lines || []);
      if (order?.order_type === 3) await loadTables();
    } catch (e) {
      console.error(e);
    }
  };

  const createNewOrder = async (orderType: OrderType = 2) => {
    try {
      const newOrder = await window.api.invoke('orders:start');
      await window.api.invoke('orders:setType', newOrder.id, orderType);
      await loadActiveOrders();
      await selectOrder(newOrder.id);
    } catch (e) {
      console.error(e);
    }
  };

  const changeOrderType = async (type: OrderType) => {
    if (!currentOrder) return;
    try {
      await window.api.invoke('orders:setType', currentOrder.id, type);
      const updated = await window.api.invoke('orders:get', currentOrder.id);
      setCurrentOrder(updated.order);
      setOrderLines(updated.lines || []);
      if (type === 3) await loadTables();
    } catch (e) {
      console.error(e);
    }
  };

  const addItemToOrder = async (item: Item, qty = 1) => {
    if (!currentOrder || item.is_outofstock) return;
    try {
      const { totals, lines } = await window.api.invoke(
        'orders:addLine',
        currentOrder.id,
        item.id,
        qty
      );
      setOrderLines(lines);
      setCurrentOrder({ ...currentOrder, ...totals });
    } catch (e) {
      console.error(e);
    }
  };

  const applyPromoCode = async (code: string) => {
    if (!currentOrder) return;
    try {
      const { order, totals } = await window.api.invoke(
        'orders:applyPromo',
        currentOrder.id,
        code
      );
      setCurrentOrder({ ...currentOrder, ...order, ...totals });
      setShowPromoDialog(false);
    } catch (e) {
      toast({
        tone: 'danger',
        title: 'Invalid or expired promo code',
        message: 'Please check the promo code details or contact support.',
      });
      console.error(e);
    }
  };

  const removePromoCode = async () => {
    if (!currentOrder) return;
    try {
      const { order, totals } = await window.api.invoke(
        'orders:removePromo',
        currentOrder.id
      );
      setCurrentOrder({ ...currentOrder, ...order, ...totals });
    } catch (e) {
      console.error(e);
    }
  };

  const loadTables = async () => {
    try {
      setTables((await window.api.invoke('tables:list')) || []);
    } catch (e) {
      console.error(e);
    }
  };

  const assignTable = async (t: TableInfo, covers: number) => {
    if (!currentOrder) return;
    try {
      await window.api.invoke('orders:setTable', currentOrder.id, {
        table_id: t.id,
        covers,
      });
      const { order } = await window.api.invoke('orders:get', currentOrder.id);
      setCurrentOrder(order);
      setShowTablePicker(false);
      await loadTables();
    } catch (e) {
      console.error(e);
      toast({
        tone: 'danger',
        title: 'Could not assign table',
        message: 'Please try again later to assign table.',
      });
    }
  };

  const clearTable = async () => {
    if (!currentOrder) return;
    try {
      await window.api.invoke('orders:clearTable', currentOrder.id);
      const { order } = await window.api.invoke('orders:get', currentOrder.id);
      setCurrentOrder(order);
      await loadTables();
    } catch (e) {
      console.error(e);
    }
  };

  const loadCities = async (stateId: string) => {
    const c = await window.api.invoke('geo:listCities', stateId);
    setCities(c || []);
  };

  const loadBlocks = async (cityId: string) => {
    const b = await window.api.invoke('geo:listBlocks', cityId);
    setBlocks(b || []);
  };

  // Filters
  const filteredSubcategories = useMemo(
    () =>
      subcategories.filter(
        (sub) => !selectedCategoryId || sub.category_id === selectedCategoryId
      ),
    [subcategories, selectedCategoryId]
  );

  // Reload items when filters change
  useEffect(() => {
    loadItems();
  }, [searchQuery, selectedCategoryId, selectedSubcategoryId]);

  const value = {
    items,
    categories,
    subcategories,
    activeOrders,
    currentOrder,
    orderLines,
    tables,
    states,
    cities,
    blocks,
    promos,
    searchQuery,
    setSearchQuery,
    selectedCategoryId,
    setSelectedCategoryId: (id: string | null) => {
      setSelectedCategoryId(id);
      setSelectedSubcategoryId(null);
    },
    selectedSubcategoryId,
    setSelectedSubcategoryId,
    filteredSubcategories,
    ui: {
      showCheckout,
      showTablePicker,
      showPromoDialog,
    },
    actions: {
      loadItems,
      loadActiveOrders,
      selectOrder,
      createNewOrder,
      changeOrderType,
      addItemToOrder,
      applyPromoCode,
      removePromoCode,
      loadTables,
      assignTable,
      clearTable,
      loadCities,
      loadBlocks,
      openCheckout: () => setShowCheckout(true),
      closeCheckout: () => setShowCheckout(false),
      openTablePicker: () => setShowTablePicker(true),
      closeTablePicker: () => setShowTablePicker(false),
      openPromoDialog: () => setShowPromoDialog(true),
      closePromoDialog: () => setShowPromoDialog(false),
    },
  };

  return (
    <OrderContext.Provider value={value}>{children}</OrderContext.Provider>
  );
};

export const useOrderContext = () => {
  const context = useContext(OrderContext);
  if (context === undefined) {
    throw new Error('useOrderContext must be used within an OrderProvider');
  }
  return context;
};
