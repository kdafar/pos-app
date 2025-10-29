import { el, els, fmtMoney, timeAgo } from '../src/renderer/utils.js';
import { refreshBrandLabel } from '../src/renderer/ui/sidebar.js';
import { showCheckoutModal } from '../src/renderer/CheckoutModal.js';

const api = window.api;

export function OrdersPage() {
  const c = document.createElement('div');
  c.style.cssText = 'height: 100%; display: flex; flex-direction: column;';

  c.innerHTML = `
    <div class="order-tabs-bar" id="orderTabsBar">
      <!-- Active order tabs will be rendered here -->
      <button class="btn new-order-btn" id="btnNewOrder">
        <span style="font-size: 18px;">+</span>
        <span>New Order</span>
      </button>
    </div>

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
          <div class="cart-title">Prepared Order</div>
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
            <button class="btn primary" id="btnCheckout" disabled>💳 Process Payment</button>
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
  let activeOrderId = null;
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

      // All items tab with icon
      const allTab = document.createElement('div');
      allTab.className = 'category-tab active';
      allTab.innerHTML = '<span style="margin-right: 6px;">🏠</span>All Items';
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

      let qty = 1;

      card.innerHTML = `
        <div style="flex: 1;">
          <div class="item-name">${item.name || 'Unnamed'}</div>
          ${item.name_ar ? `<div class="item-name-ar">${item.name_ar}</div>` : ''}
        </div>

        <div class="item-footer">
          <div class="item-price">${fmtMoney(item.price)}</div>
          ${item.barcode ? `<div class="item-badge">${item.barcode}</div>` : ''}
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; gap: 8px;">
          <div class="item-qty">
            <button class="qty-btn" data-act="dec">−</button>
            <div class="qty">1</div>
            <button class="qty-btn" data-act="inc">+</button>
          </div>
          <div class="card-actions">
            <button class="btn primary" data-act="add" style="padding: 8px 16px; font-size: 13px;">Add</button>
          </div>
        </div>
      `;

      if (!item.is_outofstock) {
        const $qty = card.querySelector('.qty');
        card.querySelector('[data-act="inc"]').addEventListener('click', (e) => {
          e.stopPropagation();
          qty = Math.min(999, qty + 1);
          $qty.textContent = qty;
        });
        card.querySelector('[data-act="dec"]').addEventListener('click', (e) => {
          e.stopPropagation();
          qty = Math.max(1, qty - 1);
          $qty.textContent = qty;
        });
        card.querySelector('[data-act="add"]').addEventListener('click', async (e) => {
          e.stopPropagation();
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
        qty: Number(q) || 1,
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

  function createCartItem(item) {
    const div = document.createElement('div');
    div.className = 'cart-item';
    const lineTotal = (Number(item.variation_price || item.price || 0)) * (Number(item.qty || 0));
    
    div.innerHTML = `
      <div class="cart-item-header">
        <div style="flex: 1; min-width: 0;">
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
    
    div.querySelector('.cart-item-remove').addEventListener('click', async () => { 
      await api.invoke('cart:remove', item.id); 
      await refreshCart(); 
    });
    div.querySelector('[data-action="inc"]').addEventListener('click', async () => { 
      await api.invoke('cart:inc', item.id); 
      await refreshCart(); 
    });
    div.querySelector('[data-action="dec"]').addEventListener('click', async () => { 
      await api.invoke('cart:dec', item.id); 
      await refreshCart(); 
    });
    
    return div;
  }

  function renderTotals(totals) {
    const container = $('#cartTotals');
    const rows = [];
    
    rows.push(`<div class="total-row"><div>Subtotal</div><div>${fmtMoney(totals.subtotal)}</div></div>`);
    
    if (totals.delivery_fee > 0) {
      rows.push(`<div class="total-row"><div>Delivery Fee</div><div>${fmtMoney(totals.delivery_fee)}</div></div>`);
    }
    
    if (totals.discount_total > 0) {
      rows.push(`<div class="total-row"><div>Discount</div><div>−${fmtMoney(totals.discount_total)}</div></div>`);
    }
    
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
        await api.invoke('cart:setContext', { 
          order_type: Number(type), 
          city_id: type === '1' ? $('#citySelect').value || null : null 
        });
        $('#citySelector').style.display = type === '1' ? 'block' : 'none';
        await refreshCart();
      });
    });
    
    try {
      const cities = await api.invoke('geo:listCities');
      const select = $('#citySelect');
      if (cities && cities.length > 0) {
        select.innerHTML = '<option value="">Select delivery city...</option>' + 
          cities.filter(c => c.is_active)
            .map(c => `<option value="${c.id}">${c.name}${c.name_ar ? ` / ${c.name_ar}` : ''}</option>`)
            .join('');
        select.addEventListener('change', async () => { 
          await api.invoke('cart:setContext', { city_id: select.value || null }); 
          await refreshCart(); 
        });
      } else {
        select.innerHTML = '<option value="">No cities available</option>';
      }
      $('#citySelector').style.display = savedType === '1' ? 'block' : 'none';
    } catch (e) {
      console.error('Failed to load cities:', e);
      $('#citySelect').innerHTML = '<option value="">Failed to load cities</option>';
    }
    
    await api.invoke('cart:setContext', { 
      order_type: Number(savedType), 
      city_id: savedType === '1' ? ($('#citySelect').value || null) : null 
    });
  }

  let searchTimeout;
  $('#search').addEventListener('input', (e) => { 
    clearTimeout(searchTimeout); 
    searchTimeout = setTimeout(() => { 
      searchQuery = e.target.value.trim(); 
      filterAndRenderItems(); 
    }, 300); 
  });
  
  $('#modeSwitch').addEventListener('change', async (e) => { 
    await api.invoke('sync:setMode', e.target.checked ? 'live' : 'offline'); 
    await refreshStatus(); 
  });
  
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
  
  $('#btnClearCart').addEventListener('click', async () => { 
    if (confirm('Clear entire cart?')) { 
      await api.invoke('cart:clear'); 
      await refreshCart(); 
    } 
  });
  
  $('#btnHold').addEventListener('click', () => {
    alert('Hold order: Coming soon - will save order for later');
  });
  
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
    await refreshCart();
  })();

  return c;
}

// Additional CSS for modern design (add to your main CSS file)
const additionalStyles = `
.order-tabs-bar {
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  padding: 12px 24px;
  display: flex;
  gap: 12px;
  overflow-x: auto;
  align-items: center;
  flex-shrink: 0;
}

.order-tabs-bar::-webkit-scrollbar {
  height: 6px;
}

.order-tab {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
  min-width: 200px;
}

.order-tab:hover {
  background: var(--surface-hover);
  border-color: var(--border-light);
  transform: translateY(-1px);
}

.order-tab.active {
  border-color: var(--accent-primary);
  background: var(--accent-glow);
}

.order-tab-info {
  flex: 1;
  min-width: 0;
}

.order-tab-number {
  font-weight: 700;
  font-size: 14px;
  color: var(--text-primary);
}

.order-tab-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.order-tab-status {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.order-tab-status.ready {
  background: var(--success-glow);
  color: var(--success);
  border: 1px solid var(--success);
}

.order-tab-status.pending {
  background: var(--warning);
  color: white;
}

.new-order-btn {
  background: var(--surface);
  border: 2px dashed var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--text-secondary);
  transition: all 0.2s;
}

.new-order-btn:hover {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
  background: var(--accent-glow);
}

.cart-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.item-card {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: default;
}

.item-card:hover:not(.disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
}

.item-qty .qty-btn {
  font-size: 18px;
  font-weight: 700;
  transition: all 0.2s;
}

.item-qty .qty-btn:hover {
  background: var(--accent-primary);
  color: white;
  border-color: var(--accent-primary);
}

.cart-item {
  margin-bottom: 10px;
  transition: all 0.2s;
}

.cart-item:last-child {
  margin-bottom: 0;
}

.cart-item-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.4;
}

.cart-item-name-ar {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
  line-height: 1.3;
}

.total-row {
  font-size: 13px;
}

.total-row.grand {
  font-size: 16px;
  padding-top: 14px;
  margin-top: 10px;
}

.btn.primary {
  font-weight: 600;
}
`;