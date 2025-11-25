// components/CommandSelect.tsx
import React, { useState } from 'react';
import { ChevronsUpDown, Search, Check as CheckIcon } from 'lucide-react';
import { Command } from 'cmdk';
import * as Popover from '@radix-ui/react-popover';

export function CommandSelect({
  theme = 'dark',
  label,
  value,
  onChange,
  options,
  placeholder = 'Search…',
  required,
  disabled,
}: {
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

  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const labelCls = theme === 'dark' ? 'text-slate-300' : 'text-gray-700';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-300';
  const surface = theme === 'dark' ? 'bg-white/5' : 'bg-white';
  const hover = theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-gray-100';

  return (
    <div>
      <label className={`block text-xs font-medium ${labelCls} mb-1`}>
        {label}{required ? ' *' : ''}
      </label>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={`w-full h-11 px-3 rounded-lg border ${border} ${surface} ${text} flex items-center justify-between text-sm disabled:opacity-50`}
          >
            <span className="truncate">
              {selected ? selected.label : `Select ${label.toLowerCase()}`}
            </span>
            <ChevronsUpDown size={16} className="opacity-60" />
          </button>
        </Popover.Trigger>

        <Popover.Content
          side="bottom"
          align="start"
          className={`w-[min(24rem,90vw)] p-2 mt-1 rounded-lg border ${border} ${surface} shadow-xl z-50`}
        >
          <Command label={`${label} search`} className={`max-h-72 overflow-auto rounded-md ${surface}`}>
            <div className={`flex items-center gap-2 px-2 py-2 rounded-md border ${border} ${surface} mb-2`}>
              <Search size={16} className="opacity-70" />
              <Command.Input
                autoFocus
                placeholder={placeholder}
                className={`w-full bg-transparent outline-none ${text} placeholder-gray-500`}
              />
            </div>

            <Command.List>
              <Command.Empty className="px-3 py-2 text-xs opacity-70">No results</Command.Empty>
              {options.map(o => (
                <Command.Item
                  key={o.id}
                  value={o.label}
                  onSelect={() => { onChange(o.id); setOpen(false); }}
                  className={`flex items-center justify-between px-3 py-3 rounded-md cursor-pointer text-sm ${hover}`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.id === value && <CheckIcon size={16} className="opacity-80" />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
