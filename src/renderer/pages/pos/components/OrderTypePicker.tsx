import { ShoppingBag, Truck, UtensilsCrossed } from 'lucide-react';
import { OrderType } from '../types';
import { useOrderTypeLabel } from '../../../i18n';

export function OrderTypePicker({ value, onChange }: {
  value: OrderType;
  onChange: (t: OrderType) => void;
}) {
  const label = useOrderTypeLabel();
  const types = [
    { key: 1 as const, label: label(1), Icon: Truck },
    { key: 2 as const, label: label(2), Icon: ShoppingBag },
    { key: 3 as const, label: label(3), Icon: UtensilsCrossed },
  ];

  return (
    <div className='inline-flex rounded-lg border border-default-200 bg-default-50 p-0.5'>
      {types.map(({ key, label: text, Icon }) => (
        <button
          key={key}
          type='button'
          onClick={() => onChange(key)}
          className={`h-8 px-2.5 rounded-md text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
            key === value
              ? 'bg-primary text-primary-foreground'
              : 'text-default-700 hover:bg-default-100 hover:text-foreground'
          }`}
          title={text}
        >
          <Icon size={15} />
          {text}
        </button>
      ))}
    </div>
  );
}
