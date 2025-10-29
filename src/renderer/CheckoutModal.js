import { el, els, fmtMoney } from './utils.js';
import api from './api.js';

export function showCheckoutModal(cartData, onComplete) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">💳 Checkout</div>
        <button class="modal-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Customer Name *</label>
          <input type="text" id="customerName" placeholder="Enter customer name" required />
        </div>
        
        <div class="form-group">
          <label class="form-label">Phone Number *</label>
          <input type="tel" id="customerPhone" placeholder="Enter phone number" required />
        </div>
        
        <div class="form-group" id="addressGroup" style="display: none;">
          <label class="form-label">Delivery Address *</label>
          <textarea id="customerAddress" placeholder="Enter delivery address"></textarea>
        </div>
        
        <div class="form-group">
          <label class="form-label">Order Notes (Optional)</label>
          <textarea id="orderNotes" placeholder="Any special instructions..."></textarea>
        </div>
        
        <div class="form-group">
          <label class="form-label">Payment Method *</label>
          <div class="payment-methods" id="paymentMethods">
            <div class="loading">Loading payment methods...</div>
          </div>
        </div>
        
        <div style="background: var(--surface); border-radius: 12px; padding: 16px; margin-top: 20px;">
          <div class="total-row">
            <div>Subtotal</div>
            <div>${fmtMoney(cartData.totals.subtotal)}</div>
          </div>
          ${cartData.totals.delivery_fee > 0 ? `
          <div class="total-row">
            <div>Delivery Fee</div>
            <div>${fmtMoney(cartData.totals.delivery_fee)}</div>
          </div>` : ''}
          ${cartData.totals.discount_total > 0 ? `
          <div class="total-row">
            <div>Discount</div>
            <div>−${fmtMoney(cartData.totals.discount_total)}</div>
          </div>` : ''}
          <div class="total-row grand">
            <div>Total Amount</div>
            <div class="value">${fmtMoney(cartData.totals.grand_total)}</div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="btnCancelCheckout">Cancel</button>
        <button class="btn primary" id="btnCompleteOrder">Complete Order</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  let selectedPaymentMethod = null;
  let orderTypeVal = null;
  
  // Load payment methods
  (async () => {
    try {
      const methods = await api.invoke('payments:listMethods');
      const container = el('#paymentMethods', overlay);
      
      if (methods && methods.length > 0) {
        container.innerHTML = '';
        methods.forEach(method => {
          const div = document.createElement('div');
          div.className = 'payment-method';
          div.textContent = method.name_en || method.slug;
          div.dataset.methodId = method.id;
          div.dataset.methodSlug = method.slug;
          
          div.addEventListener('click', () => {
            els('.payment-method', overlay).forEach(p => p.classList.remove('selected'));
            div.classList.add('selected');
            selectedPaymentMethod = method;
          });
          
          container.appendChild(div);
        });
        
        // Auto-select first method
        if (methods[0]) {
          container.firstChild.click();
        }
      } else {
        container.innerHTML = '<div class="muted">No payment methods available</div>';
      }
    } catch (e) {
      console.error('Failed to load payment methods:', e);
      el('#paymentMethods', overlay).innerHTML = '<div class="muted">Failed to load payment methods</div>';
    }
  })();
  
  // Get order type to show/hide address
  (async () => {
    orderTypeVal = await api.invoke('store:get', 'cart.order_type') || '2';
    if (orderTypeVal === '1') {
      el('#addressGroup', overlay).style.display = 'block';
    }
  })();
  
  // Close handlers
  const close = () => {
    overlay.remove();
  };
  
  el('.modal-close', overlay).addEventListener('click', close);
  el('#btnCancelCheckout', overlay).addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  
  // Complete order
  el('#btnCompleteOrder', overlay).addEventListener('click', async () => {
    const name = el('#customerName', overlay).value.trim();
    const phone = el('#customerPhone', overlay).value.trim();
    const address = el('#customerAddress', overlay).value.trim();
    const notes = el('#orderNotes', overlay).value.trim();
    
    if (!name) {
      alert('Please enter customer name');
      return;
    }
    
    if (!phone) {
      alert('Please enter phone number');
      return;
    }
    
    if (orderTypeVal === '1' && !address) {
      alert('Please enter delivery address');
      return;
    }
    
    if (!selectedPaymentMethod) {
      alert('Please select a payment method');
      return;
    }
    
    const orderData = {
      full_name: name,
      mobile: phone,
      address: orderTypeVal === '1' ? address : null,
      note: notes || null,
      payment_method_id: selectedPaymentMethod.id,
      payment_method_slug: selectedPaymentMethod.slug
    };
    
    close();
    onComplete(orderData);
  });
}