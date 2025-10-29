// src/renderer/components/OrderTabs.tsx
import { Order } from '../types';

interface OrderTabsProps {
  orders: Order[];
  currentOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
  onNewOrder: () => void;
  onCloseOrder: (orderId: string) => void;
}

export default function OrderTabs({ 
  orders, 
  currentOrderId, 
  onSelectOrder, 
  onNewOrder,
  onCloseOrder 
}: OrderTabsProps) {
  
  const getOrderTypeLabel = (type: number) => {
    switch (type) {
      case 1: return 'Delivery';
      case 2: return 'Pickup';
      case 3: return 'Dine-in';
      default: return 'Order';
    }
  };

  const getOrderTypeIcon = (type: number) => {
    switch (type) {
      case 1: return '🚚';
      case 2: return '📦';
      case 3: return '🍽️';
      default: return '🧾';
    }
  };

  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-2">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
        {/* Active Order Tabs */}
        {orders.map((order) => {
          const isActive = order.id === currentOrderId;
          const itemCount = 0; // We'd need to track this separately or pass it in
          
          return (
            <div
              key={order.id}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all cursor-pointer min-w-[180px] ${
                isActive
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
              onClick={() => onSelectOrder(order.id)}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getOrderTypeIcon(order.order_type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">
                      {order.number.replace('ORD-', '#')}
                    </div>
                    <div className="text-xs text-gray-500">
                      {getOrderTypeLabel(order.order_type)} • {formatTime(order.opened_at)}
                    </div>
                  </div>
                </div>
                
                {order.grand_total > 0 && (
                  <div className="text-xs font-semibold text-emerald-600 mt-1">
                    {order.grand_total.toFixed(3)}
                  </div>
                )}
              </div>

              {/* Close button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Close this order tab?')) {
                    onCloseOrder(order.id);
                  }
                }}
                className="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded p-1 transition-colors"
              >
                ✕
              </button>
            </div>
          );
        })}

        {/* New Order Button */}
        <button
          onClick={onNewOrder}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 hover:border-blue-500 hover:bg-blue-50 transition-all text-gray-600 hover:text-blue-600 min-w-[120px]"
        >
          <span className="text-lg">+</span>
          <span className="text-sm font-medium">New Order</span>
        </button>
      </div>
    </div>
  );
}