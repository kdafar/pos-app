import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chip } from '@heroui/react';
import { Package } from 'lucide-react';
import { fileUrl } from '../utils/fileUrl';
import { useI18n } from '../i18n';
import { DataState, PageShell, SearchField } from '../components/PageShell';

interface Item {
  id: string;
  name: string;
  name_ar: string;
  price: number;
  image?: string | null;
  image_local?: string | null;
  has_addons?: number | boolean;
}

interface Addon {
  id: string;
  group_id: string;
  name: string;
  name_ar: string;
  price: number;
}

interface AddonGroup {
  id: string;
  name: string;
  name_ar: string;
  is_required?: number | boolean;
  max_select?: number | null;
}

export function AddonsPage() {
  const { t, name: localName, money, lang } = useI18n();

  /** The catalogue deliberately shows both names; this is the *other* one. */
  const altName = (row: { name?: string; name_ar?: string }) =>
    lang === 'ar' ? row.name ?? '' : row.name_ar ?? '';

  const [items, setItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);

  const [addons, setAddons] = useState<Addon[]>([]);
  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [q, setQ] = useState('');
  const [localImageFailedFor, setLocalImageFailedFor] = useState<
    Record<string, boolean>
  >({});

  const norm = (s: any) => String(s ?? '').toLowerCase();

  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    setItemsError(null);
    try {
      const rows = await window.api.invoke('catalog:listItems', null);
      setItems(
        (rows ?? []).map((r: any) => ({
          id: String(r.id),
          name: r.name,
          name_ar: r.name_ar,
          price: Number(r.price ?? 0),
          image: r.image ?? null,
          image_local: r.image_local ?? null,
          has_addons: !!r.has_addons,
        }))
      );
    } catch (e) {
      // Previously logged and left empty, which reads as "no item has add-ons".
      setItemsError(e instanceof Error ? e.message : String(e ?? ''));
    } finally {
      setItemsLoading(false);
    }
  }, []);

  const loadAddons = useCallback(async () => {
    try {
      const rows = await window.api.invoke('catalog:listAddons', null);
      setAddons(
        (rows ?? []).map((r: any) => ({
          id: String(r.id),
          group_id: String(r.group_id),
          name: r.name,
          name_ar: r.name_ar,
          price: Number(r.price ?? 0),
        }))
      );
    } catch (e) {
      console.error('[AddonsPage] Failed to load addons', e);
      setAddons([]);
    }
  }, []);

  useEffect(() => {
    loadItems();
    loadAddons();
  }, [loadItems, loadAddons]);

  const addonsByGroup = useMemo(() => {
    const map: Record<string, Addon[]> = {};
    for (const a of addons) {
      const gid = String(a.group_id);
      (map[gid] ||= []).push(a);
    }
    return map;
  }, [addons]);

  const itemsWithAddons = useMemo(
    () => items.filter((it) => !!it.has_addons),
    [items]
  );

  const filteredItems = useMemo(() => {
    if (!q.trim()) return itemsWithAddons;
    const qq = norm(q);
    return itemsWithAddons.filter(
      (i) => norm(i.name).includes(qq) || norm(i.name_ar).includes(qq)
    );
  }, [itemsWithAddons, q]);

  const selectItem = useCallback(async (item: Item) => {
    setSelectedItem(item);
    setGroupsLoading(true);
    setGroupsError(null);
    try {
      const rows = await window.api.invoke('catalog:listAddonGroups', {
        itemId: item.id,
      });
      setAddonGroups(
        (rows ?? []).map((r: any) => ({
          id: String(r.id),
          name: r.name,
          name_ar: r.name_ar,
          is_required: r.is_required,
          max_select: r.max_select,
        }))
      );
    } catch (e) {
      // An item flagged has_addons whose groups fail to load previously showed
      // "no groups" — which is the one answer that is definitely wrong.
      setGroupsError(e instanceof Error ? e.message : String(e ?? ''));
      setAddonGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  const ItemImage = ({ it, size }: { it: Item; size: number }) => {
    const localFailed = localImageFailedFor[it.id];
    const localSrc =
      it.image_local && !localFailed ? fileUrl(it.image_local) : null;
    const activeSrc = localSrc || it.image || null;

    return (
      <div
        className='rounded-lg overflow-hidden bg-default-100 shrink-0 flex items-center justify-center'
        style={{ width: size, height: size }}
      >
        {activeSrc ? (
          <img
            src={activeSrc}
            alt={it.name}
            loading='lazy'
            className='w-full h-full object-cover object-center'
            onError={() => {
              if (localSrc)
                setLocalImageFailedFor((prev) => ({ ...prev, [it.id]: true }));
            }}
          />
        ) : (
          <Package size={size / 3} className='text-default-400' />
        )}
      </div>
    );
  };

  const Price = ({ value }: { value: number }) => (
    <span className='whitespace-nowrap font-semibold'>
      <span className='money'>{money(value)}</span>{' '}
      <span className='text-default-600'>{t('common.currency')}</span>
    </span>
  );

  return (
    <PageShell
      title={t('admin.addons.itemsTitle')}
      count={itemsLoading || itemsError ? undefined : filteredItems.length}
      onRefresh={() => {
        loadItems();
        loadAddons();
      }}
      refreshing={itemsLoading}
      filters={
        <SearchField
          value={q}
          onChange={setQ}
          placeholder={t('admin.addons.searchItems')}
        />
      }
    >
      {/*
        Was a fixed `320px 1fr` grid, which on a scaled 13" screen left the
        detail panel too narrow to read and on a 4K one wasted the width. It
        stacks below 64rem and gives the list a share of the space above it.
      */}
      <div className='grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr] items-start'>
        {/* LEFT: items that have add-ons */}
        <div className='rounded-lg border border-default-200 bg-content1 overflow-hidden'>
          <DataState
            loading={itemsLoading}
            error={itemsError}
            onRetry={loadItems}
            empty={filteredItems.length === 0}
            emptyTitle={t('admin.addons.noItems')}
          >
            <div className='max-h-[70vh] overflow-y-auto nice-scroll divide-y divide-default-200'>
              {filteredItems.map((it) => {
                const isActive = selectedItem?.id === it.id;
                return (
                  <button
                    key={it.id}
                    onClick={() => selectItem(it)}
                    aria-selected={isActive}
                    className={`w-full text-start flex gap-3 p-2.5 items-center transition-colors
                      ${
                        isActive
                          ? // A start-edge marker, not a tint: a light fill on
                            // the dark theme hides the text it sits behind.
                            'bg-default-200 border-s-4 border-s-primary font-semibold'
                          : 'hover:bg-default-100 border-s-4 border-s-transparent'
                      }`}
                  >
                    <ItemImage it={it} size={52} />
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center justify-between gap-2'>
                        <div className='text-sm truncate'>{localName(it)}</div>
                        <div className='text-xs'>
                          <Price value={it.price} />
                        </div>
                      </div>
                      <div className='text-[11px] text-default-600 truncate'>
                        {altName(it)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </DataState>
        </div>

        {/* RIGHT: the selected item and its groups */}
        <div className='space-y-4 min-w-0'>
          <div className='rounded-lg border border-default-200 bg-content1 p-4'>
            {selectedItem ? (
              <div className='flex gap-4 items-center min-w-0'>
                <ItemImage it={selectedItem} size={76} />
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center justify-between gap-2'>
                    <h2 className='text-lg font-bold truncate text-foreground'>
                      {localName(selectedItem)}
                    </h2>
                    <Price value={selectedItem.price} />
                  </div>
                  <div className='text-sm text-default-600 truncate'>
                    {altName(selectedItem)}
                  </div>
                  <div className='mt-2 flex items-center gap-2 flex-wrap'>
                    <Chip size='sm' variant='flat' className='font-medium'>
                      <span className='money' dir='ltr'>
                        {selectedItem.id}
                      </span>
                    </Chip>
                    <Chip
                      size='sm'
                      variant='flat'
                      color='success'
                      className='font-semibold'
                    >
                      {t('admin.addons.hasGroups')}
                    </Chip>
                  </div>
                </div>
              </div>
            ) : (
              <div className='text-sm font-medium text-default-600'>
                {t('admin.addons.selectItemHint')}
              </div>
            )}
          </div>

          <div className='rounded-lg border border-default-200 bg-content1 p-4'>
            <h3 className='font-bold text-base text-foreground mb-3'>
              {t('admin.addons.groupsTitle')}
            </h3>

            <DataState
              loading={groupsLoading}
              error={groupsError}
              onRetry={() => selectedItem && selectItem(selectedItem)}
              empty={!selectedItem || addonGroups.length === 0}
              emptyTitle={
                !selectedItem
                  ? t('admin.addons.noItemSelected')
                  : t('admin.addons.noGroups')
              }
            >
              <div className='flex flex-col gap-3'>
                {addonGroups.map((g) => {
                  const list = addonsByGroup[g.id] || [];
                  return (
                    <div
                      key={g.id}
                      className='rounded-lg border border-default-200 p-3 bg-default-50'
                    >
                      <div className='flex items-start justify-between gap-2 mb-1.5'>
                        <div className='min-w-0'>
                          <div className='font-semibold text-sm truncate'>
                            {localName(g)}
                          </div>
                          <div className='text-[11px] text-default-600 truncate'>
                            {altName(g)}
                          </div>
                        </div>
                        <div className='flex items-center gap-1.5 flex-wrap justify-end shrink-0'>
                          {/* Required vs optional decides whether a cashier can
                              skip the group, so it is a tone, not fine print. */}
                          <Chip
                            size='sm'
                            variant='flat'
                            color={g.is_required ? 'warning' : 'default'}
                            className='font-semibold'
                          >
                            {g.is_required
                              ? t('common.required')
                              : t('common.optional')}
                          </Chip>
                          {g.max_select && Number(g.max_select) > 0 && (
                            <Chip size='sm' variant='flat'>
                              {t('admin.addons.maxSelected', {
                                n: String(g.max_select),
                              })}
                            </Chip>
                          )}
                          <Chip size='sm' variant='flat'>
                            {t('admin.addons.count', { n: list.length })}
                          </Chip>
                        </div>
                      </div>

                      {list.length === 0 ? (
                        <div className='text-xs font-medium text-default-600'>
                          {t('admin.addons.noneInGroup')}
                        </div>
                      ) : (
                        <div className='mt-2 border-t border-default-200 pt-2 space-y-1.5'>
                          {list.map((a) => (
                            <div
                              key={a.id}
                              className='flex items-center justify-between gap-2 text-xs'
                            >
                              <div className='min-w-0'>
                                <div className='font-medium truncate'>
                                  {localName(a)}
                                </div>
                                <div className='text-default-600 truncate'>
                                  {altName(a)}
                                </div>
                              </div>
                              <Price value={a.price} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </DataState>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
