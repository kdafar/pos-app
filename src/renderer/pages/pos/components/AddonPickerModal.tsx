import { useEffect, useState, useMemo } from 'react';
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@heroui/react';
import { Check, AlertTriangle } from 'lucide-react';
import { QtyStepper } from '../../../components/QtyStepper';
import { DataState } from '../../../components/PageShell';
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
  /**
   * Unused — every colour in here is a HeroUI semantic token that resolves
   * itself in both themes. Kept declared only because CatalogPanel still passes
   * it; it can go when that call site is migrated.
   */
  theme: 'light' | 'dark';
  item: Item;
  onClose: () => void;
  onConfirm: (selection: ItemSelection) => void;
};

type GroupWithAddons = AddonGroup & { addons: Addon[] };

/**
 * A tile in this modal is either chosen or not, and a cashier has to tell which
 * at a glance mid-order. So the chosen state is the brand border plus its
 * focus glow on the same surface, and never a tinted fill.
 */
const TILE_BASE =
  'w-full flex items-center justify-between gap-2 min-h-12 px-3 py-2.5 rounded-[13px] border text-start text-sm transition';
const TILE_SELECTED =
  'border-[var(--brand)] bg-surface ink shadow-[0_0_0_3px_var(--brand-ring)]';
const TILE_IDLE =
  'border-line-strong bg-surface ink hover:bg-surface-2';

export function AddonPickerModal({ item, onClose, onConfirm }: Props) {
  const { t, name: localName, money } = useI18n();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupWithAddons[]>([]);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [variationId, setVariationId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [lineQty, setLineQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  // Tracked separately from `error`, which also carries validation messages.
  // Without it, a failed load leaves groups and variations empty, which
  // validateSelection() reads as "nothing to choose" and passes — so the item
  // goes into the order at its base price, with required groups skipped and
  // no variation, and the cashier gets no signal at all.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setLoadFailed(false);

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
          setLoadFailed(true);
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
    // An item whose options could not be read must not be priced as though it
    // had none — that is how a sized item gets sold at 0.000.
    if (loadFailed) return { ok: false, msg: t('opts.loadFailed') };

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

  const hasNothingToPick = groups.length === 0 && variations.length === 0;

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size='2xl'
      placement='center'
      backdrop='opaque'
      scrollBehavior='inside'
      classNames={{
        wrapper: 'p-2 sm:p-4',
        base: 'ui-popup !rounded-[24px] m-0 w-full max-h-[calc(100dvh-2rem)]',
        backdrop: 'bg-black/50',
      }}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className='flex flex-col gap-1'>
              <span className='text-xs font-semibold uppercase tracking-wide ink-2'>
                {t('opts.title')}
              </span>
              <span className='text-lg font-semibold leading-snug ink'>
                {localName(item)}
              </span>
              <span className='text-sm font-medium ink-2'>
                {t('opts.basePrice')}:{' '}
                <span className='money font-semibold ink'>
                  {money(itemBasePrice)}
                </span>
              </span>
            </ModalHeader>

            <ModalBody className='gap-4 overflow-y-auto'>
              <DataState
                loading={loading}
                // A load failure also leaves this empty, but it already speaks
                // for itself in the banner below — don't also claim the item
                // simply has no options.
                empty={hasNothingToPick && !error}
                emptyTitle={t('opts.none')}
              >
                <div className='flex flex-col gap-4'>
                  {/* Variations — exactly one must be picked */}
                  {variations.length > 0 && (
                    <div className='space-y-3 rounded-[16px] border border-line bg-surface p-3 sm:p-4'>
                      <div className='space-y-1.5'>
                        <div className='font-semibold ink'>
                          {t('opts.variation')}
                        </div>
                        <div className='flex flex-wrap items-center gap-2'>
                          <Chip
                            size='sm'
                            variant='solid'
                            color='danger'
                            className='font-semibold'
                          >
                            {t('common.required')}
                          </Chip>
                          <span className='text-xs font-medium ink-2'>
                            {t('opts.chooseOne')}
                          </span>
                        </div>
                      </div>

                      <div className='grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-2'>
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
                              aria-pressed={isSelected}
                              className={`${TILE_BASE} ${
                                isSelected ? TILE_SELECTED : TILE_IDLE
                              }`}
                            >
                              <div className='min-w-0 space-y-0.5'>
                                <div className='truncate font-medium'>
                                  {localName(v)}
                                </div>
                                {v.name_ar && (
                                  <div className='truncate text-xs font-medium ink-2'>
                                    {v.name_ar}
                                  </div>
                                )}
                              </div>
                              <span className='ms-2 flex shrink-0 items-center gap-1.5'>
                                <span className='money text-sm font-semibold'>
                                  {money(v.effective_price)}
                                </span>
                                {isSelected && (
                                  <Check size={16} strokeWidth={1.8} className='text-[var(--brand-strong)]' />
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {groups.map((g) => {
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
                        className='space-y-3 rounded-[16px] border border-line bg-surface p-3 sm:p-4'
                      >
                        <div className='flex items-start justify-between gap-2'>
                          <div className='min-w-0 space-y-1.5'>
                            <div className='font-semibold ink'>
                              {localName(g)}
                            </div>
                            <div className='flex flex-wrap items-center gap-2'>
                              <Chip
                                size='sm'
                                variant='solid'
                                color={isRequired ? 'danger' : 'success'}
                                className='font-semibold'
                              >
                                {isRequired
                                  ? t('common.required')
                                  : t('common.optional')}
                              </Chip>
                              {max != null && max > 0 && (
                                <span className='text-xs font-medium ink-2'>
                                  {t('opts.maxChoices', { n: max })}
                                </span>
                              )}
                            </div>
                          </div>

                          {selectedCount > 0 && (
                            <Chip
                              size='sm'
                              variant='solid'
                              color='primary'
                              className='shrink-0 font-semibold'
                              startContent={<Check size={13} strokeWidth={1.8} />}
                            >
                              {t('opts.selected', { n: selectedCount })}
                            </Chip>
                          )}
                        </div>

                        {/* Addons grid */}
                        <div className='grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-2'>
                          {g.addons.map((a) => {
                            const qty = selection[a.id] ?? 0;
                            const isSelected = qty > 0;
                            return (
                              <div
                                key={a.id}
                                onClick={() => !isSelected && toggleAddon(a)}
                                className={`${TILE_BASE} ${
                                  isSelected
                                    ? TILE_SELECTED
                                    : `${TILE_IDLE} cursor-pointer`
                                }`}
                              >
                                <div className='min-w-0 space-y-0.5'>
                                  <div className='truncate font-medium'>
                                    {localName(a)}
                                  </div>
                                  <div className='text-xs font-medium ink-2'>
                                    + <span className='money'>{money(a.price)}</span>
                                    {qty > 1 && (
                                      <span className='ms-1 font-semibold'>
                                        × {qty} ={' '}
                                        <span className='money'>
                                          {money(a.price * qty)}
                                        </span>
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
                                  <span className='shrink-0 text-xs font-medium ink-2'>
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
                </div>
              </DataState>

              {error && (
                <div className='ui-notice text-sm font-medium'>
                  <AlertTriangle size={16} strokeWidth={1.8} className='mt-0.5 shrink-0 text-[var(--st-red)]' />
                  <span>{error}</span>
                </div>
              )}
            </ModalBody>

            <ModalFooter className='flex-col items-stretch gap-3 border-t border-line sm:flex-row sm:items-center sm:justify-between'>
              <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
                <div className='flex items-center gap-2'>
                  <span className='text-xs font-semibold uppercase tracking-wide ink-2'>
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

                <div className='text-xs font-medium ink-2'>
                  <div>
                    {t('common.each')}:{' '}
                    <span className='money font-semibold ink'>
                      {money(totalWithAddons)}
                    </span>{' '}
                    (<span className='money'>{money(itemBasePrice)}</span> +{' '}
                    <span className='money'>{money(addonsExtraTotal)}</span>)
                  </div>
                  <div className='mt-0.5'>
                    {t('opts.lineTotal')}:&nbsp;
                    <span className='money font-bold ink'>
                      {money(lineTotal)}
                    </span>
                  </div>
                </div>
              </div>

              <div className='flex items-center justify-end gap-2'>
                <Button
                  variant='bordered'
                  size='lg'
                  className='rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                  onPress={onClose}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  color='primary'
                  size='lg'
                  className='rounded-[13px] font-semibold'
                  startContent={<Check size={18} strokeWidth={1.8} />}
                  // Blocked outright rather than left clickable-and-refused:
                  // the options are unknown, so there is no correct price to
                  // add at.
                  isDisabled={loadFailed}
                  onPress={handleConfirm}
                >
                  {t('opts.addToOrder')}
                </Button>
              </div>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
