// components/CommandSelect.tsx
import { useState } from 'react';
import { ChevronsUpDown, Search, Check as CheckIcon } from 'lucide-react';
import { Command } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';

/**
 * Searchable single-select used by the checkout address pickers.
 *
 * The popover behaviour is cmdk + Radix and is deliberately left alone; only
 * the colours moved. Every one of them is now a HeroUI semantic token, so the
 * control reads correctly in both themes from one definition — the previous
 * `theme === 'dark' ? … : …` pairs meant a light-only `text-gray-900` was
 * rendered whenever the caller's theme prop drifted from the real one.
 */
export function CommandSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Search…',
  required,
  disabled,
}: {
  /**
   * Unused — the colours below resolve themselves in both themes. Kept declared
   * only because CheckoutModal still passes it.
   */
  theme?: 'light' | 'dark';
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: Array<{ id: string; label: string }>;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.id === value);

  return (
    <div>
      <label className="block text-sm font-semibold text-default-700 mb-1">
        {label}{required ? ' *' : ''}
      </label>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            // A disabled picker says so with its surface and its cursor, never
            // by fading the text — this is read at arm's length on a till.
            className="w-full h-11 px-3 rounded-lg border border-default-200 bg-default-100 text-foreground flex items-center justify-between text-sm font-medium disabled:bg-default-200 disabled:cursor-not-allowed"
          >
            <span className="truncate">
              {selected ? selected.label : `Select ${label.toLowerCase()}`}
            </span>
            <ChevronsUpDown size={16} className="shrink-0 ms-2 text-default-700" />
          </button>
        </Popover.Trigger>

        <Popover.Content
          side="bottom"
          align="start"
          className="w-[min(24rem,90vw)] p-2 mt-1 rounded-lg border border-default-200 bg-content1 shadow-xl z-50"
        >
          <Command label={`${label} search`} className="max-h-72 overflow-auto nice-scroll rounded-md bg-transparent">
            <div className="flex items-center gap-2 px-2 py-2 rounded-md border border-default-200 bg-default-100 mb-2">
              <Search size={16} className="shrink-0 text-default-700" />
              <Command.Input
                autoFocus
                placeholder={placeholder}
                className="w-full bg-transparent outline-none text-foreground placeholder:text-default-700"
              />
            </div>

            <Command.List>
              <Command.Empty className="px-3 py-2 text-sm font-medium text-default-700">No results</Command.Empty>
              {options.map(o => (
                <Command.Item
                  key={o.id}
                  value={o.label}
                  onSelect={() => { onChange(o.id); setOpen(false); }}
                  // `data-[selected]` is cmdk's keyboard cursor, so the arrow
                  // keys get the same highlight the mouse does.
                  className="flex items-center justify-between gap-2 px-3 py-3 rounded-md cursor-pointer text-sm text-foreground hover:bg-default-200 data-[selected=true]:bg-default-200"
                >
                  <span className={`truncate ${o.id === value ? 'font-semibold text-primary' : 'font-medium'}`}>
                    {o.label}
                  </span>
                  {o.id === value && <CheckIcon size={16} className="shrink-0 text-primary" />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
