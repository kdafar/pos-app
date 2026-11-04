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
 * `theme === 'dark' ? … : …` pairs meant a light-only `text-foreground` was
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
      <label className="block text-sm font-semibold ink-2 mb-1">
        {label}{required ? ' *' : ''}
      </label>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            // A disabled picker says so with its surface and its cursor, never
            // by fading the text — this is read at arm's length on a till.
            className="w-full min-h-11 px-3 rounded-[11px] border border-line-strong bg-surface ink flex items-center justify-between text-sm font-medium transition-colors focus-visible:border-[var(--brand)] focus-visible:shadow-[0_0_0_4px_var(--brand-ring)] disabled:bg-surface-2 disabled:cursor-not-allowed"
          >
            <span className="truncate">
              {selected ? selected.label : `Select ${label.toLowerCase()}`}
            </span>
            <ChevronsUpDown size={16} strokeWidth={1.8} className="shrink-0 ms-2 ink-2" />
          </button>
        </Popover.Trigger>

        <Popover.Content
          side="bottom"
          align="start"
          className="ui-popup w-[min(24rem,calc(100vw-1.5rem))] p-2 mt-1 z-50"
        >
          <Command label={`${label} search`} className="max-h-72 overflow-auto nice-scroll rounded-[11px] bg-transparent">
            <div className="flex items-center gap-2 px-2 py-2 min-h-11 rounded-[11px] border border-line-strong bg-surface mb-2">
              <Search size={16} strokeWidth={1.8} className="shrink-0 ink-2" />
              <Command.Input
                autoFocus
                placeholder={placeholder}
                className="w-full bg-transparent outline-none ink placeholder:text-default-500"
              />
            </div>

            <Command.List>
              <Command.Empty className="px-3 py-2 text-sm font-medium ink-2">No results</Command.Empty>
              {options.map(o => (
                <Command.Item
                  key={o.id}
                  value={o.label}
                  onSelect={() => { onChange(o.id); setOpen(false); }}
                  // `data-[selected]` is cmdk's keyboard cursor, so the arrow
                  // keys get the same highlight the mouse does.
                  className="flex items-center justify-between gap-2 px-3 py-3 min-h-11 rounded-[11px] cursor-pointer text-sm ink hover:bg-[var(--hover)] data-[selected=true]:bg-[var(--hover)]"
                >
                  <span className={`truncate ${o.id === value ? 'font-semibold text-[var(--brand-strong)]' : 'font-medium'}`}>
                    {o.label}
                  </span>
                  {o.id === value && <CheckIcon size={16} strokeWidth={1.8} className="shrink-0 text-[var(--brand)]" />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
