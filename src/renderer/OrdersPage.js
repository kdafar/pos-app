import { el, els, fmtMoney, timeAgo } from './utils.js';
import { refreshBrandLabel } from '../ui/sidebar.js';
import { showCheckoutModal } from './CheckoutModal.js';
import api from '../api.js';

export function OrdersPage() {
  const c = document.createElement('div');
  c.style.cssText = 'height: 100%; display: flex; flex-direction: column;';

  c.innerHTML = `
    <div class="top-bar">
      <div class="status-badges">
        <div class="badge" id="modeBadge">
          <span id="modeText">Live</span>
        </div>
        <span style="color: var(--text-muted); font-size: 12px;">
          Last sync: <span id="lastSync">never</span>
        </span>
      </div>
      <div style="display: flex; gap: 12px; align-items: center;">
        <button class="btn" id="btnSyncNow">🔄 Sync Now</button>
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="modeSwitch" style="width: 18px; height: 18px; cursor: pointer;"/>
          <span style="font-size: 13px;">Live Mode</span>
        </label>
      </div>
    </div>

    <div class="order-line">
      <div class="order-line-head">
        <div class="ol-title">Order Line</div>
        <div class="ol-filters" id="olFilters">
          <button class="chip active" data-ol="all">All</button>
          <button class="chip" data-ol="3">Dine in</button>
          <button class="chip" data-ol="2">Take Away</button>
          <button class="chip" data-ol="1">Delivery</button>
        </div>
        <div style="margin-left:auto">
          <button class="chip" id="olRecent">Recent Order ▾</button>
        </div>
      </div>
      <div class="order-cards" id="orderCards">
        <!-- open order cards render here -->
      </div>
    </div>

    <div class="pos-layout">
      <!-- Left: Items -->
      <div class="pos-left">
        <div class="search-bar">
          <div class="search-wrapper">
            <input type="search" id="search" class="search-input" placeholder="Search items by name, Arabic name, or barcode..." />
          </div>
        </div>

        <div class="category-tabs" id="categoryTabs">
          <div class="loading">Loading categories...</div>
        </div>

        <div class="subcategory-bar" id="subcategoryBar" style="display: none;">
          <!-- Subcategories will be loaded here -->
        </div>

        <div class="items-container">
          <div class="items-grid" id="itemsGrid">
            <div class="loading">Loading items...</div>
          </div>
        </div>
      </div>

      <!-- Right: Cart -->
      <div class="pos-right">
        <div class="order-type-selector">
          <div class="order-type-tabs">
            <div class="order-type-tab" data-type="2">
              <div class="order-type-icon">📦</div>
              <div>Pickup</div>
            </div>
            <div class="order-type-tab" data-type="1">
              <div class="order-type-icon">🚚</div>
              <div>Delivery</div>
            </div>
            <div class="order-type-tab" data-type="3">
              <div class="order-type-icon">🍽️</div>
              <div>Dine-in</div>
            </div>
          </div>
          <div class="city-selector" id="citySelector" style="display: none;">
            <select id="citySelect">
              <option value="">Select delivery city...</option>
            </select>
          </div>
        </div>

        <div class="cart-header">
          <div class="cart-title">Current Order</div>
          <button class="btn danger" id="btnClearCart" style="padding: 8px 14px; font-size: 12px;" disabled>Clear All</button>
        </div>

        <div class="cart-items" id="cartItems">
          <div class="cart-empty">
            <div class="cart-empty-icon">🛒</div>
            <div>Cart is empty</div>
            <div style="font-size: 12px; color: var(--text-muted);">Add items to get started</div>
          </div>
        </div>

        <div class="cart-footer">
          <div class="cart-totals" id="cartTotals">
            <div class="total-row grand">
              <div>Total</div>
              <div class="value">0.000</div>
            </div>
          </div>
          <div class="cart-actions">
            <button class="btn" id="btnHold" disabled>📋 Hold</button>
            <button class="btn primary" id="btnCheckout" disabled>💳 Checkout</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const $ = (s) => c.querySelector(s);

  // State
  let categories = [];
  let subcategories = [];
  let allItems = [];
  let activeCategory = null;
  let activeSubcategory = null;
  let searchQuery = '';

  async function refreshStatus() {
    const st = await api.invoke('sync:getStatus');
    const isLive = (st.mode || 'live') === 'live';
    $('#modeSwitch').checked = isLive;
    $('#modeBadge').className = isLive ? 'badge live' : 'badge offline';
    $('#modeText').textContent = isLive ? 'Live' : 'Offline';
    $('#lastSync').textContent = timeAgo(st.last_sync_at);
    $('#btnSyncNow').disabled = !isLive;
  }

  async function loadCategories() {
    try {
      categories = await api.invoke('catalog:listCategories');
      const tabsContainer = $('#categoryTabs');
      tabsContainer.innerHTML = '';

      // All items tab
      const allTab = document.createElement('div');
      allTab.className = 'category-tab active';
      allTab.textContent = '🏠 All Items';
      allTab.dataset.categoryId = '';
      allTab.addEventListener('click', () => selectCategory(null));
      tabsContainer.appendChild(allTab);

      // Category tabs
      categories.filter(cat => cat.visible).sort((a, b) => (a.position || 99) - (b.position || 99)).forEach(cat => {
        const tab = document.createElement('div');
        tab.className = 'category-tab';
        tab.textContent = cat.name || cat.name_ar || 'Unnamed';
        tab.dataset.categoryId = cat.id;
        tab.addEventListener('click', () => selectCategory(cat.id));
        tabsContainer.appendChild(tab);
      });
    } catch (e) {
      console.error('Failed to load categories:', e);
      $('#categoryTabs').innerHTML = '<div class="loading">Failed to load categories</div>';
    }
  }

  el('#olFilters', c).addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  els('.chip', el('#olFilters', c)).forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  orderFilter = b.dataset.ol || 'all';
  renderOpenOrders();
});

  async function loadSubcategories(categoryId) {
    if (!categoryId) {
      $('#subcategoryBar').style.display = 'none';
      return;
    }

    try {
      subcategories = await api.invoke('catalog:listSubcategories', categoryId);
      const subBar = $('#subcategoryBar');
      
      if (subcategories.length === 0 || subcategories.filter(s => s.visible).length === 0) {
        subBar.style.display = 'none';
        return;
      }

      subBar.style.display = 'flex';
      subBar.innerHTML = '';

      // All subcategories pill
      const allPill = document.createElement('div');
      allPill.className = 'subcategory-pill active';
      allPill.textContent = 'All';
      allPill.dataset.subcategoryId = '';
      allPill.addEventListener('click', () => selectSubcategory(null));
      subBar.appendChild(allPill);

      // Subcategory pills
      subcategories.filter(sub => sub.visible).forEach(sub => {
        const pill = document.createElement('div');
        pill.className = 'subcategory-pill';
        pill.textContent = sub.name || sub.name_ar || 'Unnamed';
        pill.dataset.subcategoryId = sub.id;
        pill.addEventListener('click', () => selectSubcategory(sub.id));
        subBar.appendChild(pill);
      });
    } catch (e) {
      console.error('Failed to load subcategories:', e);
      $('#subcategoryBar').style.display = 'none';
    }
  }

  async function loadAllItems() {
    try {
      allItems = await api.invoke('catalog:listItems', null);
      filterAndRenderItems();
    } catch (e) {
      console.error('Failed to load items:', e);
      $('#itemsGrid').innerHTML = '<div class="loading">Failed to load items</div>';
    }
  }

  function selectCategory(categoryId) {
    activeCategory = categoryId;
    activeSubcategory = null;

    // Update active tab
    els('.category-tab', c).forEach(tab => {
      tab.classList.toggle('active', tab.dataset.categoryId === categoryId || (categoryId === null && tab.dataset.categoryId === ''));
    });

    loadSubcategories(categoryId);
    filterAndRenderItems();
  }

  function selectSubcategory(subcategoryId) {
    activeSubcategory = subcategoryId;

    // Update active pill
    els('.subcategory-pill', c).forEach(pill => {
      pill.classList.toggle('active', pill.dataset.subcategoryId === subcategoryId || (subcategoryId === null && pill.dataset.subcategoryId === ''));
    });

    filterAndRenderItems();
  }

  function filterAndRenderItems() {
    let items = [...allItems];
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(item => 
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.name_ar && item.name_ar.toLowerCase().includes(q)) ||
        (item.barcode && item.barcode === searchQuery)
      );
    }

    if (activeCategory) {
      items = items.filter(item => item.category_id === activeCategory);
    }

    if (activeSubcategory) {
      items = items.filter(item => item.subcategory_id === activeSubcategory);
    }

    renderItems(items);
  }

  function renderItems(items) {
    const grid = $('#itemsGrid');
    
    if (items.length === 0) {
      grid.innerHTML = '<div class="loading">No items found</div>';
      return;
    }

    grid.innerHTML = '';
items.forEach(item => {
  const card = document.createElement('div');
  card.className = 'item-card' + (item.is_outofstock ? ' disabled' : '');

  // local qty state per card
  let qty = 1;

  card.innerHTML = `
    <div>
      <div class="item-name">${item.name || 'Unnamed'}</div>
      ${item.name_ar ? `<div class="item-name-ar">${item.name_ar}</div>` : ''}
    </div>

    <div class="item-footer">
      <div class="item-price">${fmtMoney(item.price)}</div>
      ${item.barcode ? `<div class="item-badge">${item.barcode}</div>` : ''}
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div class="item-qty">
        <button class="qty-btn" data-act="dec">−</button>
        <div class="qty">${qty}</div>
        <button class="qty-btn" data-act="inc">+</button>
      </div>
      <div class="card-actions">
        <button class="btn primary" data-act="add">Add To Cart</button>
      </div>
    </div>
  `;

  if (!item.is_outofstock) {
    const $qty = card.querySelector('.qty');
    card.querySelector('[data-act="inc"]').addEventListener('click', () => {
      qty = Math.min(999, qty + 1); $qty.textContent = qty;
    });
    card.querySelector('[data-act="dec"]').addEventListener('click', () => {
      qty = Math.max(1, qty - 1); $qty.textContent = qty;
    });
    card.querySelector('[data-act="add"]').addEventListener('click', async () => {
      await addToCart(item, qty);
    });
  }

  grid.appendChild(card);
});
  }

  async function addToCart(item, q = 1) {
    if (!activeOrderId) {
    await api.invoke('cart:add', {
      item_id: String(item.id),
      item_name: item.name,
      item_name_ar: item.name_ar || null,
      price: Number(item.price) || 0,
      qty: Number(q) || 1
    });
    await refreshCart();
    return;
  }
  }

  async function refreshCart() {
    try {
      const { rows, totals } = await api.invoke('cart:list');
      const container = $('#cartItems');

      const hasItems = rows && rows.length > 0;
      $('#btnHold').disabled = !hasItems;
      $('#btnCheckout').disabled = !hasItems;
      $('#btnClearCart').disabled = !hasItems;

      if (!hasItems) {
        container.innerHTML = `
          <div class="cart-empty">
            <div class="cart-empty-icon">🛒</div>
            <div>Cart is empty</div>
            <div style="font-size: 12px; color: var(--text-muted);">Add items to get started</div>
          </div>
        `;
      } else {
        container.innerHTML = '';
        rows.forEach(item => {
          const cartItem = createCartItem(item);
          container.appendChild(cartItem);
        });
      }

      renderTotals(totals);
    } catch (e) {
      console.error('Failed to refresh cart:', e);
    }
  }

  let openOrders = [];
let orderFilter = 'all';

async function loadOpenOrders() {
  try {
    const list = await api.invoke('orders:listOpen'); // id, number, status, subtotal, grand_total, opened_at
    openOrders = Array.isArray(list) ? list : [];
    await renderOpenOrders();
  } catch (e) {
    console.error('Failed to load open orders:', e);
    el('#orderCards', c).innerHTML = '<div class="loading">No open orders</div>';
  }
}

async function renderOpenOrders() {
  const wrap = el('#orderCards', c);
  let orders = [...openOrders];

  if (orderFilter !== 'all') {
    const t = Number(orderFilter);
    orders = orders.filter(o => Number(o.order_type) === t);
  }

  if (!orders.length) {
    wrap.innerHTML = '<div class="loading">No open orders</div>';
    return;
  }

  // For the first 8 orders, fetch line counts quickly
  const limited = orders.slice(0, 8);
  const counts = await Promise.all(limited.map(async o => {
    try {
      const res = await api.invoke('orders:get', o.id);
      return (res?.lines?.length) || 0;
    } catch { return 0; }
  }));

  wrap.innerHTML = '';
  limited.forEach((o, i) => {
    const typeLabel = ({1:'Delivery',2:'Take Away',3:'Dine in'})[Number(o.order_type) || 2] || 'Pickup';
    const ago = timeAgo(o.opened_at || 0);
    const itemsCount = counts[i];

    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="oc-top">
        <div class="oc-id">Order ${o.number ? '#'+o.number : ''}</div>
        <span class="badge success">${(o.status || 'open').toString().toLowerCase()==='open' ? 'Open' : 'Ready'}</span>
      </div>
      <div class="oc-meta">${typeLabel} • ${ago}</div>
      <div class="oc-footer">
        <span class="pill">${itemsCount} items</span>
        <span class="pill">Total ${fmtMoney(o.grand_total || o.subtotal || 0)}</span>
        <button class="pill primary" data-order="${o.id}">It’s Done</button>
      </div>
    `;
    card.querySelector('[data-order]')?.addEventListener('click', async () => {
      try {
        await api.invoke('orders:close', o.id);
        await loadOpenOrders();
      } catch(e){ console.error(e); }
    });
    wrap.appendChild(card);
  });
}


  function createCartItem(item) {
    const div = document.createElement('div');
    div.className = 'cart-item';
    const lineTotal = (Number(item.variation_price || item.price || 0)) * (Number(item.qty || 0));
    div.innerHTML = `
      <div class="cart-item-header">
        <div style="flex: 1;">
          <div class="cart-item-name">${item.item_name || item.name || 'Item'}</div>
          ${item.item_name_ar ? `<div class="cart-item-name-ar">${item.item_name_ar}</div>` : ''}
        </div>
        <button class="cart-item-remove">✕</button>
      </div>
      <div class="cart-item-footer">
        <div class="qty-control">
          <button class="qty-btn" data-action="dec">−</button>
          <div class="qty-value">${Number(item.qty).toFixed(0)}</div>
          <button class="qty-btn" data-action="inc">+</button>
        </div>
        <div class="cart-item-total">${fmtMoney(lineTotal)}</div>
      </div>
    `;
    div.querySelector('.cart-item-remove').addEventListener('click', async () => { await api.invoke('cart:remove', item.id); await refreshCart(); });
    div.querySelector('[data-action="inc"]').addEventListener('click', async () => { await api.invoke('cart:inc', item.id); await refreshCart(); });
    div.querySelector('[data-action="dec"]').addEventListener('click', async () => { await api.invoke('cart:dec', item.id); await refreshCart(); });
    return div;
  }

  function renderTotals(totals) {
    const container = $('#cartTotals');
    const rows = [ `<div class="total-row"><div>Subtotal</div><div>${fmtMoney(totals.subtotal)}</div></div>` ];
    if (totals.delivery_fee > 0) rows.push(`<div class="total-row"><div>Delivery Fee</div><div>${fmtMoney(totals.delivery_fee)}</div></div>`);
    if (totals.discount_total > 0) rows.push(`<div class="total-row"><div>Discount</div><div>−${fmtMoney(totals.discount_total)}</div></div>`);
    rows.push(`<div class="total-row grand"><div>Total</div><div class="value">${fmtMoney(totals.grand_total)}</div></div>`);
    container.innerHTML = rows.join('');
  }

  async function initOrderType() {
    const savedType = await api.invoke('store:get', 'cart.order_type') || '2';
    els('.order-type-tab', c).forEach(tab => {
      tab.classList.toggle('active', tab.dataset.type === savedType);
      tab.addEventListener('click', async () => {
        const type = tab.dataset.type;
        els('.order-type-tab', c).forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        await api.invoke('cart:setContext', { order_type: Number(type), city_id: type === '1' ? $('#citySelect').value || null : null });
        $('#citySelector').style.display = type === '1' ? 'block' : 'none';
        await refreshCart();
      });
    });
    try {
      const cities = await api.invoke('geo:listCities');
      const select = $('#citySelect');
      if (cities && cities.length > 0) {
        select.innerHTML = '<option value="">Select delivery city...</option>' + cities.filter(c => c.is_active).map(c => `<option value="${c.id}">${c.name}${c.name_ar ? ` / ${c.name_ar}` : ''}</option>`).join('');
        select.addEventListener('change', async () => { await api.invoke('cart:setContext', { city_id: select.value || null }); await refreshCart(); });
      } else {
        select.innerHTML = '<option value="">No cities available</option>';
      }
      $('#citySelector').style.display = savedType === '1' ? 'block' : 'none';
    } catch (e) {
      console.error('Failed to load cities:', e);
      $('#citySelect').innerHTML = '<option value="">Failed to load cities</option>';
    }
    await api.invoke('cart:setContext', { order_type: Number(savedType), city_id: savedType === '1' ? ($('#citySelect').value || null) : null });
  }

  let searchTimeout;
  $('#search').addEventListener('input', (e) => { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { searchQuery = e.target.value.trim(); filterAndRenderItems(); }, 300); });
  $('#modeSwitch').addEventListener('change', async (e) => { await api.invoke('sync:setMode', e.target.checked ? 'live' : 'offline'); await refreshStatus(); });
  $('#btnSyncNow').addEventListener('click', async () => {
    const btn = $('#btnSyncNow');
    btn.disabled = true;
    btn.textContent = '⏳ Syncing...';
    try {
      await api.invoke('sync:now');
      await loadCategories();
      await loadAllItems();
      await refreshBrandLabel();
    } catch (e) {
      console.error('Sync failed:', e);
      alert('Sync failed: ' + (e.message || 'Unknown error'));
    }
    btn.textContent = '🔄 Sync Now';
    await refreshStatus();
  });
  $('#btnClearCart').addEventListener('click', async () => { if (confirm('Clear entire cart?')) { await api.invoke('cart:clear'); await refreshCart(); } });
  $('#btnHold').addEventListener('click', () => alert('Hold order: Coming soon - will save order for later'));
  $('#btnCheckout').addEventListener('click', async () => {
    const { rows, totals } = await api.invoke('cart:list');
    if (rows.length === 0) return alert('Cart is empty!');
    showCheckoutModal({ rows, totals }, async (orderData) => {
      try {
        const { order, lines } = await api.invoke('orders:createFromCart', orderData);
        if (!order || !order.id) throw new Error('Order creation failed on the backend.');
        const status = await api.invoke('sync:getStatus');
        if (status.mode === 'live') {
          const envelope = { client_msg_id: `order-${order.id}-${Date.now()}` };
          const batch = { orders: [{ ...order, lines }] };
          await api.invoke('sync:push', envelope, batch);
        }
        alert(`Order #${order.number} created successfully!`);
        await api.invoke('cart:clear');
        await refreshCart();
      } catch (e) {
        console.error('Failed to complete order:', e);
        alert('Failed to complete order: ' + (e.message || 'Unknown error'));
      }
    });
  });

  (async () => {
    await refreshStatus();
    await initOrderType();
    await loadCategories();
    await loadAllItems();
     await loadOpenOrders();
    await refreshCart();
  })();

  return c;
}