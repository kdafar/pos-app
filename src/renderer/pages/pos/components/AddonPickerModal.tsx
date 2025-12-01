import React, { useEffect, useState, useMemo } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';
import { Item, AddonGroup, Addon, SelectedAddon } from '../types';

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

type Props = {
  theme: 'light' | 'dark';
  item: Item;
  onClose: () => void;
  onConfirm: (selection: SelectedAddon[]) => void;
};

type GroupWithAddons = AddonGroup & { addons: Addon[] };

export function AddonPickerModal({ theme, item, onClose, onConfirm }: Props) {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupWithAddons[]>([]);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
  const border = theme === 'dark' ? 'border-white/10' : 'border-gray-200';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const rawGroups: AddonGroup[] = await window.api.invoke(
          'catalog:listAddonGroups',
          { itemId: item.id }
        );

        const fullGroups: GroupWithAddons[] = [];
        for (const g of rawGroups ?? []) {
          const addons: Addon[] = await window.api.invoke(
            'catalog:listAddons',
            { groupId: g.id }
          );
          fullGroups.push({ ...g, addons: addons ?? [] });
        }

        if (!cancelled) {
          setGroups(fullGroups);
        }
      } catch (e) {
        console.error('[AddonPickerModal] Failed to load addons', e);
        if (!cancelled) {
          setError('Failed to load add-ons for this item.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const toggleAddon = (addon: Addon) => {
    setSelection((prev) => {
      const key = addon.id;
      const current = prev[key] ?? 0;
      const next = current > 0 ? 0 : 1; // simple toggle
      const copy = { ...prev };
      if (next <= 0) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  };

  const selectionByGroup = useMemo(() => {
    const map: Record<string, SelectedAddon[]> = {};
    for (const g of groups) {
      map[g.id] = [];
    }
    for (const g of groups) {
      for (const a of g.addons) {
        const qty = selection[a.id];
        if (qty && qty > 0) {
          if (!map[g.id]) map[g.id] = [];
          map[g.id].push({ id: a.id, group_id: g.id, qty });
        }
      }
    }
    return map;
  }, [groups, selection]);

  // 💰 Extra price from addons
  const addonsExtraTotal = useMemo(() => {
    let total = 0;
    for (const g of groups) {
      for (const a of g.addons) {
        const qty = selection[a.id] ?? 0;
        if (qty > 0) total += qty * (a.price || 0);
      }
    }
    return +total.toFixed(3);
  }, [groups, selection]);

  const validateSelection = (): { ok: boolean; msg?: string } => {
    for (const g of groups) {
      const isRequired =
        g.is_required === 1 || g.is_required === true || g.is_required === '1';
      const max = g.max_select ?? null;
      const selectedForGroup = selectionByGroup[g.id] ?? [];
      const count = selectedForGroup.reduce((sum, x) => sum + x.qty, 0);

      if (isRequired && count === 0) {
        return {
          ok: false,
          msg: `Please select at least one option for "${g.name}".`,
        };
      }
      if (max != null && max > 0 && count > max) {
        return {
          ok: false,
          msg: `You can select up to ${max} options for "${g.name}".`,
        };
      }
    }
    return { ok: true };
  };

  const handleConfirm = () => {
    const { ok, msg } = validateSelection();
    if (!ok && msg) {
      setError(msg);
      return;
    }

    const flat: SelectedAddon[] = [];
    for (const g of groups) {
      const selectedForGroup = selectionByGroup[g.id] ?? [];
      flat.push(...selectedForGroup);
    }

    onConfirm(flat);
  };

  const itemBasePrice = +Number(item.price || 0).toFixed(3);
  const totalWithAddons = +(itemBasePrice + addonsExtraTotal).toFixed(3);

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm px-3'>
      <div
        className={`${bg} ${border} border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden`}
      >
        {/* Header */}
        <div
          className={`flex items-start justify-between px-5 py-4 border-b ${border}`}
        >
          <div className='space-y-1'>
            <div
              className={`text-[11px] uppercase tracking-[0.14em] ${textMuted}`}
            >
              Customize your order
            </div>
            <div className={`text-base font-semibold ${text} leading-snug`}>
              {item.name}
            </div>
            <div className={`text-xs ${textMuted}`}>
              Base price:{' '}
              <span className='font-semibold'>{itemBasePrice.toFixed(3)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`rounded-full p-1.5 mt-1
              ${
                theme === 'dark'
                  ? 'hover:bg-white/10 text-slate-300'
                  : 'hover:bg-gray-100 text-gray-600'
              }`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className='flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 nice-scroll'>
          {loading && (
            <div className={`text-center py-8 ${textMuted} text-sm`}>
              Loading add-ons…
            </div>
          )}

          {!loading && groups.length === 0 && (
            <div className={`text-center py-8 ${textMuted} text-sm`}>
              No add-ons configured for this item.
            </div>
          )}

          {!loading &&
            groups.map((g) => {
              const groupSelected = selectionByGroup[g.id] ?? [];
              const isRequired =
                g.is_required === 1 ||
                g.is_required === true ||
                g.is_required === '1';
              const max = g.max_select ?? null;
              const selectedCount = groupSelected.reduce(
                (sum, s) => sum + s.qty,
                0
              );

              return (
                <div
                  key={g.id}
                  className={`rounded-xl border ${border} p-3.5 sm:p-4 space-y-3`}
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='space-y-1'>
                      <div className={`font-medium ${text}`}>{g.name}</div>
                      <div className='flex flex-wrap items-center gap-1 text-[11px]'>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded-full ${
                            isRequired
                              ? theme === 'dark'
                                ? 'bg-rose-500/10 text-rose-200 border border-rose-500/40'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                              : theme === 'dark'
                              ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/30'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {isRequired ? 'Required' : 'Optional'}
                        </span>
                        {max != null && max > 0 && (
                          <span className={`${textMuted}`}>
                            Max {max} {max === 1 ? 'choice' : 'choices'}
                          </span>
                        )}
                      </div>
                    </div>

                    {selectedCount > 0 && (
                      <div
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${
                          theme === 'dark'
                            ? 'bg-blue-500/15 text-blue-100 border border-blue-500/40'
                            : 'bg-blue-50 text-blue-800 border border-blue-200'
                        }`}
                      >
                        <Check size={12} /> {selectedCount} selected
                      </div>
                    )}
                  </div>

                  {/* Addons grid */}
                  <div className='grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2'>
                    {g.addons.map((a) => {
                      const qty = selection[a.id] ?? 0;
                      const isSelected = qty > 0;
                      return (
                        <button
                          key={a.id}
                          type='button'
                          onClick={() => toggleAddon(a)}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-sm transition
                            ${
                              isSelected
                                ? theme === 'dark'
                                  ? 'bg-blue-500/20 border border-blue-500/40 text-blue-50'
                                  : 'bg-blue-50 border border-blue-300 text-blue-900'
                                : theme === 'dark'
                                ? 'bg-white/5 border border-white/10 text-slate-100 hover:bg-white/10'
                                : 'bg-white border border-gray-200 text-gray-800 hover:bg-gray-50'
                            }`}
                        >
                          <div className='space-y-0.5'>
                            <div className='font-medium truncate'>{a.name}</div>
                            <div className={`text-[11px] ${textMuted}`}>
                              + {a.price.toFixed(3)}
                            </div>
                          </div>
                          {isSelected && (
                            <div className='flex items-center gap-1 text-xs'>
                              <span className='inline-flex items-center justify-center w-6 h-6 rounded-full bg-black/10'>
                                {qty}
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          {error && (
            <div
              className={`mt-1 flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${
                theme === 'dark'
                  ? 'bg-rose-500/10 text-rose-200 border border-rose-500/40'
                  : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}
            >
              <AlertTriangle size={14} className='mt-0.5 shrink-0' />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={`px-4 sm:px-5 py-3 border-t ${border} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`}
        >
          <div className={`text-xs ${textMuted}`}>
            <div>
              Base:{' '}
              <span className='font-semibold'>{itemBasePrice.toFixed(3)}</span>
            </div>
            <div>
              Add-ons:{' '}
              <span className='font-semibold'>
                {addonsExtraTotal.toFixed(3)}
              </span>
            </div>
            <div className='mt-0.5 text-[11px]'>
              Total:&nbsp;
              <span className='font-semibold text-blue-600 dark:text-blue-300'>
                {totalWithAddons.toFixed(3)}
              </span>
            </div>
          </div>

          <div className='flex items-center justify-end gap-2'>
            <button
              onClick={onClose}
              className={`px-3.5 py-1.5 rounded-lg text-sm
                ${
                  theme === 'dark'
                    ? 'bg-white/5 text-slate-200 hover:bg-white/10'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5
                ${
                  theme === 'dark'
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
            >
              <Check size={16} />
              Add to order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
