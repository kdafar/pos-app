import React, { useEffect, useMemo, useState } from 'react';
// 👇 adjust this path to match where fileUrl actually lives
import { fileUrl } from '../utils/fileUrl';

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
  const [items, setItems] = useState<Item[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);

  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  const [q, setQ] = useState('');
  const [localImageFailedFor, setLocalImageFailedFor] = useState<
    Record<string, boolean>
  >({});

  const norm = (s: any) => String(s ?? '').toLowerCase();

  /* ---------- Load all items (once) ---------- */
  useEffect(() => {
    let cancelled = false;

    async function loadItems() {
      try {
        setItemsLoading(true);
        const rows = await window.api.invoke('catalog:listItems', null);

        if (cancelled) return;

        const mapped: Item[] = rows.map((r: any) => ({
          id: String(r.id),
          name: r.name,
          name_ar: r.name_ar,
          price: Number(r.price ?? 0),
          image: r.image ?? null,
          image_local: r.image_local ?? null,
          has_addons: !!r.has_addons,
        }));

        setItems(mapped);
      } catch (e) {
        console.error('[AddonsPage] Failed to load items', e);
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    }

    loadItems();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- Load all addons (once) ---------- */
  useEffect(() => {
    let cancelled = false;

    async function loadAddons() {
      try {
        const rows = await window.api.invoke('catalog:listAddons', null);
        if (cancelled) return;

        const mapped: Addon[] = rows.map((r: any) => ({
          id: String(r.id),
          group_id: String(r.group_id),
          name: r.name,
          name_ar: r.name_ar,
          price: Number(r.price ?? 0),
        }));

        setAddons(mapped);
      } catch (e) {
        console.error('[AddonsPage] Failed to load addons', e);
      }
    }

    loadAddons();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- Group addons by group_id ---------- */
  const addonsByGroup = useMemo(() => {
    const map: Record<string, Addon[]> = {};
    for (const a of addons) {
      const gid = String(a.group_id);
      if (!map[gid]) map[gid] = [];
      map[gid].push(a);
    }
    return map;
  }, [addons]);

  /* ---------- Only items that have addons ---------- */
  const itemsWithAddons = useMemo(
    () => items.filter((it) => !!it.has_addons),
    [items]
  );

  /* ---------- Search filter ---------- */
  const filteredItems = useMemo(() => {
    if (!q.trim()) return itemsWithAddons;
    const qq = norm(q);
    return itemsWithAddons.filter(
      (i) => norm(i.name).includes(qq) || norm(i.name_ar).includes(qq)
    );
  }, [itemsWithAddons, q]);

  /* ---------- When item clicked: load its addon groups ---------- */
  async function handleSelectItem(item: Item) {
    setSelectedItem(item);
    setGroupsLoading(true);
    try {
      const rows = await window.api.invoke('catalog:listAddonGroups', {
        itemId: item.id,
      });

      const mapped: AddonGroup[] = rows.map((r: any) => ({
        id: String(r.id),
        name: r.name,
        name_ar: r.name_ar,
        is_required: r.is_required,
        max_select: r.max_select,
      }));

      setAddonGroups(mapped);
    } catch (e) {
      console.error(
        '[AddonsPage] Failed to load addon groups for item',
        item.id,
        e
      );
      setAddonGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  }

  /* ---------- Image renderer (same logic style as ItemCard) ---------- */
  function renderItemImage(it: Item) {
    const localFailed = localImageFailedFor[it.id];
    const localSrc =
      it.image_local && !localFailed ? fileUrl(it.image_local) : null;
    const remoteSrc = it.image || null;
    const activeSrc = localSrc || remoteSrc;

    if (!activeSrc) {
      return (
        <div className='w-14 h-14 flex items-center justify-center text-[10px] opacity-60'>
          No image
        </div>
      );
    }

    return (
      <img
        src={activeSrc}
        alt={it.name}
        loading='lazy'
        className='w-14 h-14 object-cover object-center'
        onError={() => {
          if (localSrc) {
            setLocalImageFailedFor((prev) => ({ ...prev, [it.id]: true }));
          }
        }}
      />
    );
  }

  return (
    <div
      style={{
        margin: '24px',
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        gap: '24px',
      }}
    >
      {/* LEFT: Items (only those with addons) */}
      <div className='flex flex-col gap-3'>
        <div className='flex items-center justify-between mb-1'>
          <h3 className='text-lg font-semibold'>Items with Addons</h3>
        </div>

        <input
          className='px-3 py-2 rounded-lg border border-white/10 bg-transparent text-sm mb-2'
          placeholder='Search items (EN/AR)…'
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div className='flex-1 min-h-0 overflow-auto rounded-xl border border-white/10'>
          {itemsLoading ? (
            <div className='p-3 text-sm opacity-70'>Loading items…</div>
          ) : filteredItems.length === 0 ? (
            <div className='p-3 text-sm opacity-70'>
              No items with addons found.
            </div>
          ) : (
            <div className='divide-y divide-white/5'>
              {filteredItems.map((it) => {
                const isActive = selectedItem?.id === it.id;
                return (
                  <button
                    key={it.id}
                    onClick={() => handleSelectItem(it)}
                    className={
                      'w-full text-left flex gap-3 p-2.5 items-center transition ' +
                      (isActive
                        ? 'bg-blue-500/20 border-l-2 border-blue-400'
                        : 'hover:bg-white/5')
                    }
                  >
                    <div className='rounded-lg overflow-hidden bg-black/30 flex-shrink-0'>
                      {renderItemImage(it)}
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center justify-between gap-2'>
                        <div className='font-medium text-sm truncate'>
                          {it.name}
                        </div>
                        <div className='text-xs opacity-80 whitespace-nowrap'>
                          {it.price.toFixed(3)} KD
                        </div>
                      </div>
                      <div className='text-[11px] opacity-70 truncate'>
                        {it.name_ar}
                      </div>
                      <div className='mt-1 flex items-center gap-1 text-[11px]'>
                        <span className='inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'>
                          Has addons
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Selected item + addon groups & addons */}
      <div className='flex flex-col gap-4'>
        {/* Selected item header */}
        <div className='rounded-xl border border-white/10 p-4'>
          {selectedItem ? (
            <div className='flex gap-4 items-center'>
              <div className='rounded-lg overflow-hidden bg-black/30 flex-shrink-0 w-20 h-20 flex items-center justify-center'>
                {renderItemImage(selectedItem)}
              </div>
              <div className='flex-1 min-w-0'>
                <div className='flex items-center justify-between gap-2'>
                  <h3 className='text-lg font-semibold truncate'>
                    {selectedItem.name}
                  </h3>
                  <div className='text-sm opacity-80 whitespace-nowrap'>
                    {selectedItem.price.toFixed(3)} KD
                  </div>
                </div>
                <div className='text-sm opacity-70 truncate'>
                  {selectedItem.name_ar}
                </div>
                <div className='mt-2 flex items-center gap-2 text-xs opacity-80'>
                  <span className='inline-flex items-center px-2 py-0.5 rounded-full bg-white/5'>
                    ID: {selectedItem.id}
                  </span>
                  <span className='inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'>
                    Has addon groups
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className='text-sm opacity-70'>
              Select an item on the left to see its addon groups and addons.
            </div>
          )}
        </div>

        {/* Addon groups + addons */}
        <div className='rounded-xl border border-white/10 p-4 min-h-[260px]'>
          <div className='flex items-center justify-between mb-3'>
            <h4 className='font-semibold text-base'>Addon Groups</h4>
            {groupsLoading && (
              <span className='text-xs opacity-70'>Loading…</span>
            )}
          </div>

          {!selectedItem ? (
            <div className='text-sm opacity-70'>No item selected.</div>
          ) : addonGroups.length === 0 ? (
            <div className='text-sm opacity-70'>
              This item has no addon groups.
            </div>
          ) : (
            <div className='flex flex-col gap-3'>
              {addonGroups.map((g) => {
                const list = addonsByGroup[g.id] || [];
                return (
                  <div
                    key={g.id}
                    className='rounded-lg border border-white/10 p-3 bg-white/2'
                  >
                    <div className='flex items-center justify-between gap-2 mb-1.5'>
                      <div>
                        <div className='font-medium text-sm'>{g.name}</div>
                        <div className='text-[11px] opacity-70'>
                          {g.name_ar}
                        </div>
                      </div>
                      <div className='flex flex-col items-end text-[11px] opacity-80 gap-0.5'>
                        <span>{g.is_required ? 'Required' : 'Optional'}</span>
                        {g.max_select && Number(g.max_select) > 0 && (
                          <span>Max {g.max_select} selected</span>
                        )}
                        <span>{list.length} addons</span>
                      </div>
                    </div>

                    {list.length === 0 ? (
                      <div className='text-xs opacity-60'>
                        No addons assigned to this group.
                      </div>
                    ) : (
                      <div className='mt-2 border-t border-white/5 pt-2 space-y-1.5'>
                        {list.map((a) => (
                          <div
                            key={a.id}
                            className='flex items-center justify-between text-xs'
                          >
                            <div>
                              <div className='font-medium'>{a.name}</div>
                              <div className='opacity-70'>{a.name_ar}</div>
                            </div>
                            <div className='opacity-80 whitespace-nowrap'>
                              {a.price.toFixed(3)} KD
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
