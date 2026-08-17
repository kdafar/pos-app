import React, { useEffect, useState, useMemo } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';
import { QtyStepper } from '../../../components/QtyStepper';
import { useI18n } from '../../../i18n';
import {
  Item,
  AddonGroup,
  Addon,
  SelectedAddon,
  Variation,
  ItemSelection,
} from '../types';

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: any[]) => Promise<any> };
  }
}

type Props = {
  theme: 'light' | 'dark';
  item: Item;
  onClose: () => void;
  onConfirm: (selection: ItemSelection) => void;
};

type GroupWithAddons = AddonGroup & { addons: Addon[] };

export function AddonPickerModal({ theme, item, onClose, onConfirm }: Props) {
  const { t, name: localName, money } = useI18n();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupWithAddons[]>([]);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [variationId, setVariationId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [lineQty, setLineQty] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const bg = theme === 'dark' ? 'bg-slate-900' : 'bg-white';
  const text = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textMuted = 'text-default-700';
  const border = 'border-default-200';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        const [rawGroups, vars]: [AddonGroup[], Variation[]] = await Promise.all(
          [
            window.api.invoke('catalog:listAddonGroups', { itemId: item.id }),
            window.api.invoke('catalog:listVariations', { itemId: item.id }),
          ]
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
          setVariations(vars ?? []);
          // Preselect the only/cheapest variation so one tap is enough.
          setVariationId(vars?.length ? String(vars[0].id) : null);
        }
      } catch (e) {
        console.error('[AddonPickerModal] Failed to load item options', e);
        if (!cancelled) {
          setError(t('opts.loadFailed'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const selectedVariation = useMemo(
    () => variations.find((v) => String(v.id) === variationId) ?? null,
    [variations, variationId]
  );

  const setAddonQty = (addon: Addon, next: number) => {
    setSelection((prev) => {
      const copy = { ...prev };
      if (next <= 0) delete copy[addon.id];
      else copy[addon.id] = next;
      return copy;
    });
    setError(null);
  };

  const toggleAddon = (addon: Addon) => {
    setAddonQty(addon, (selection[addon.id] ?? 0) > 0 ? 0 : 1);
  };

  /**
   * Highest quantity this addon may reach given the group's max_select, which
   * caps the group as a whole — so the ceiling depends on its siblings.
   * Returns null when the group is uncapped.
   */
  const maxForAddon = (
    group: GroupWithAddons,
    addon: Addon
  ): number | null => {
    const groupMax = group.max_select ?? null;
    if (groupMax == null || groupMax <= 0) return null;
    const others = group.addons.reduce(
      (sum, a) => sum + (a.id === addon.id ? 0 : selection[a.id] ?? 0),
      0
    );
    return Math.max(0, groupMax - others);
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
    if (variations.length > 0 && !selectedVariation) {
      return { ok: false, msg: t('opts.pickVariation') };
    }

    for (const g of groups) {
      const isRequired =
        g.is_required === 1 || g.is_required === true || g.is_required === '1';
      const max = g.max_select ?? null;
      const selectedForGroup = selectionByGroup[g.id] ?? [];
      const count = selectedForGroup.reduce((sum, x) => sum + x.qty, 0);

      if (isRequired && count === 0) {
        return {
          ok: false,
          msg: t('opts.pickRequired', { group: localName(g) }),
        };
      }
      if (max != null && max > 0 && count > max) {
        return {
          ok: false,
          msg: t('opts.tooMany', { n: max, group: localName(g) }),
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

    onConfirm({
      variation_id: selectedVariation ? String(selectedVariation.id) : null,
      addons: flat,
      qty: lineQty,
    });
  };

  // The variation replaces the item price — it never adds to it.
  const itemBasePrice = +Number(
    selectedVariation
      ? selectedVariation.effective_price ?? 0
      : item.price || 0
  ).toFixed(3);
  const totalWithAddons = +(itemBasePrice + addonsExtraTotal).toFixed(3);
  const lineTotal = +(totalWithAddons * lineQty).toFixed(3);

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
              {t('opts.title')}
            </div>
            <div className={`text-base font-semibold ${text} leading-snug`}>
              {localName(item)}
            </div>
            <div className={`text-xs ${textMuted}`}>
              {t('opts.basePrice')}:{' '}
              <span className='font-semibold money'>{money(itemBasePrice)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`rounded-full p-1.5 mt-1
              ${
                'hover:bg-default-200 text-default-700'
              }`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className='flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 nice-scroll'>
          {loading && (
            <div className={`text-center py-8 ${textMuted} text-sm`}>
              {t('common.loading')}
            </div>
          )}

          {!loading && groups.length === 0 && variations.length === 0 && (
            <div className={`text-center py-8 ${textMuted} text-sm`}>
              {t('opts.none')}
            </div>
          )}

          {/* Variations — exactly one must be picked */}
          {!loading && variations.length > 0 && (
            <div className={`rounded-xl border ${border} p-3.5 sm:p-4 space-y-3`}>
              <div className='space-y-1'>
                <div className={`font-medium ${text}`}>{t('opts.variation')}</div>
                <div className='flex flex-wrap items-center gap-1 text-[11px]'>
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded-full ${
                      theme === 'dark'
                        ? 'bg-rose-500/10 text-rose-200 border border-rose-500/40'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {t('common.required')}
                  </span>
                  <span className={textMuted}>{t('opts.chooseOne')}</span>
                </div>
              </div>

              <div className='grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2'>
                {variations.map((v) => {
                  const isSelected = String(v.id) === variationId;
                  return (
                    <button
                      key={v.id}
                      type='button'
                      onClick={() => {
                        setVariationId(String(v.id));
                        setError(null);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-start text-sm transition
                        ${
                          isSelected
                            ? theme === 'dark'
                              ? 'bg-blue-500/20 border border-blue-500/40 text-blue-50'
                              : 'bg-blue-50 border border-blue-300 text-blue-900'
                            : 'bg-default-100 border border-default-200 text-foreground hover:bg-default-200'
                        }`}
                    >
                      <div className='space-y-0.5 min-w-0'>
                        <div className='font-medium truncate'>{localName(v)}</div>
                        {v.name_ar && (
                          <div className={`text-[11px] ${textMuted} truncate`}>
                            {v.name_ar}
                          </div>
                        )}
                      </div>
                      <span className='text-xs font-semibold shrink-0 ms-2'>
                        <span className='money'>{money(v.effective_price)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
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
                      <div className={`font-medium ${text}`}>{localName(g)}</div>
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
                          {isRequired ? t('common.required') : t('common.optional')}
                        </span>
                        {max != null && max > 0 && (
                          <span className={`${textMuted}`}>
                            {t('opts.maxChoices', { n: max })}
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
                        <Check size={12} /> {t('opts.selected', { n: selectedCount })}
                      </div>
                    )}
                  </div>

                  {/* Addons grid */}
                  <div className='grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2'>
                    {g.addons.map((a) => {
                      const qty = selection[a.id] ?? 0;
                      const isSelected = qty > 0;
                      return (
                        <div
                          key={a.id}
                          onClick={() => !isSelected && toggleAddon(a)}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-start text-sm transition
                            ${
                              isSelected
                                ? theme === 'dark'
                                  ? 'bg-blue-500/20 border border-blue-500/40 text-blue-50'
                                  : 'bg-blue-50 border border-blue-300 text-blue-900'
                                : 'bg-default-100 border border-default-200 text-foreground hover:bg-default-200 cursor-pointer'
                            }`}
                        >
                          <div className='space-y-0.5 min-w-0'>
                            <div className='font-medium truncate'>{localName(a)}</div>
                            <div className={`text-[11px] ${textMuted}`}>
                              + <span className='money'>{money(a.price)}</span>
                              {qty > 1 && (
                                <span className='ms-1 font-semibold'>
                                  × {qty} = <span className='money'>{money(a.price * qty)}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {isSelected ? (
                            <QtyStepper
                              value={qty}
                              min={0}
                              max={maxForAddon(g, a)}
                              label={`${a.name} quantity`}
                              onChange={(n) => setAddonQty(a, n)}
                            />
                          ) : (
                            <span className={`text-[11px] ${textMuted} shrink-0`}>
                              {t('opts.tapToAdd')}
                            </span>
                          )}
                        </div>
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
          <div className='flex items-center gap-4'>
            <div className='flex items-center gap-2'>
              <span className={`text-[11px] uppercase tracking-wide ${textMuted}`}>
                {t('common.qty')}
              </span>
              <QtyStepper
                value={lineQty}
                min={1}
                max={999}
                size='md'
                label='Item quantity'
                onChange={setLineQty}
              />
            </div>

            <div className={`text-xs ${textMuted}`}>
              <div>
                {t('common.each')}:{' '}
                <span className='font-semibold'>
                  <span className='money'>{money(totalWithAddons)}</span>
                </span>
                <span className='text-default-700'>
                  {' '}
                  (<span className='money'>{money(itemBasePrice)}</span> + <span className='money'>{money(addonsExtraTotal)}</span>)
                </span>
              </div>
              <div className='mt-0.5 text-[11px]'>
                {t('opts.lineTotal')}:&nbsp;
                <span className='font-semibold text-blue-600 dark:text-blue-300'>
                  <span className='money'>{money(lineTotal)}</span>
                </span>
              </div>
            </div>
          </div>

          <div className='flex items-center justify-end gap-2'>
            <button
              onClick={onClose}
              className={`px-3.5 py-1.5 rounded-lg text-sm
                ${
                  'bg-default-100 text-foreground hover:bg-default-200'
                }`}
            >
              {t('common.cancel')}
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
              {t('opts.addToOrder')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
