import { ShoppingBag, Truck, UtensilsCrossed } from 'lucide-react';
import { OrderType } from '../types';
import { useOrderTypeLabel } from '../../../i18n';

export function OrderTypePicker({ value, onChange, allowDelivery = true }: {
  value: OrderType;
  onChange: (t: OrderType) => void;
  /**
   * From `general.enable_delivery`. Gated on the setting, never on whether
   * there happen to be delivery orders today — a picker whose buttons come and
   * go with the day's mix is worse than one extra button.
   */
  allowDelivery?: boolean;
}) {
  const label = useOrderTypeLabel();
  const all = [
    { key: 1 as const, label: label(1), Icon: Truck },
    { key: 2 as const, label: label(2), Icon: ShoppingBag },
    { key: 3 as const, label: label(3), Icon: UtensilsCrossed },
  ];
  // An order that is ALREADY delivery keeps its button even when the setting is
  // off, so the control never misrepresents the order in front of the cashier.
  // It stops them starting a new one; it does not hide what this one is.
  const types = all.filter((t) => t.key !== 1 || allowDelivery || value === 1);

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
