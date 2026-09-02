// src/renderer/pages/ItemDetailPanel.tsx
import { useEffect, useState } from 'react';
import { Chip, Spinner } from '@heroui/react';
import { useI18n } from '../i18n';

import { errorLine as errLine } from '../utils/posError';
/**
 * What an item actually sells as: its sizes and its add-on groups.
 *
 * This used to live on a separate Add-ons page that listed the same items over
 * again so you could pick one and read its detail elsewhere — which means
 * holding a row in your head while you travel to it, and it only ever listed
 * items that already had add-ons. Variations were not shown in admin at all,
 * despite being what the customer is charged for.
 *
 * Loaded on expand rather than with the list: a shop with 500 items would
 * otherwise make 1000 queries to render one page.
 */

type Variation = {
  id: string | number;
  name: string;
  name_ar?: string | null;
  price?: number | null;
  sale_price?: number | null;
  effective_price?: number | null;
};

type AddonGroup = {
  id: string | number;
  name: string;
  name_ar?: string | null;
  is_required?: number | boolean;
  max_select?: number | null;
};

type Addon = {
  id: string | number;
  group_id: string | number;
  name: string;
  name_ar?: string | null;
  price: number;
};

export function ItemDetailPanel({
  itemId,
  hasVariations,
  hasAddons,
}: {
  itemId: string;
  hasVariations?: boolean;
  hasAddons?: boolean;
}) {
  const { t, name: localName, money } = useI18n();
  const [variations, setVariations] = useState<Variation[]>([]);
  const [groups, setGroups] = useState<AddonGroup[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [v, g, a] = await Promise.all([
          window.api.invoke('catalog:listVariations', { itemId }),
          window.api.invoke('catalog:listAddonGroups', { itemId }),
          window.api.invoke('catalog:listAddons', null),
        ]);
        if (cancelled) return;
        setVariations(v || []);
        setGroups(g || []);
        setAddons(a || []);
      } catch (e) {
        if (!cancelled)
          setError(errLine(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (loading) {
    return (
      <div className='flex items-center gap-2 py-2 text-sm font-medium text-default-700'>
        <Spinner size='sm' />
        {t('common.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className='py-2 text-sm font-semibold text-danger break-words'>
        {error}
      </div>
    );
  }

  const nothing = variations.length === 0 && groups.length === 0;

  if (nothing) {
    return (
      <div className='py-2 text-sm font-medium text-default-700'>
        {/* A flag saying the item has options while none load is worth stating
            plainly — it means the catalogue and its options disagree. */}
        {hasVariations || hasAddons
          ? t('admin.items.optionsMissing')
          : t('admin.items.noOptions')}
      </div>
    );
  }

  return (
    <div className='grid gap-4 md:grid-cols-2 min-w-0'>
      {variations.length > 0 && (
        <section className='min-w-0'>
          <h4 className='text-xs uppercase tracking-wider font-bold text-default-700 mb-2'>
            {t('opts.variation')}
          </h4>
          <ul className='space-y-1'>
            {variations.map((v) => {
              // A sale price is what the customer actually pays, so it leads
              // and the original is struck through beside it.
              const sale = Number(v.sale_price) || 0;
              const base = Number(v.price) || 0;
              const effective = Number(v.effective_price ?? (sale || base)) || 0;
              return (
                <li
                  key={v.id}
                  className='flex items-center justify-between gap-2 text-sm'
                >
                  <span className='truncate'>{localName(v)}</span>
                  <span className='whitespace-nowrap font-semibold'>
                    {sale > 0 && base > 0 && sale !== base && (
                      <span className='money text-default-700 line-through me-1.5 font-normal'>
                        {money(base)}
                      </span>
                    )}
                    <span className='money'>{money(effective)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {groups.length > 0 && (
        <section className='min-w-0'>
          <h4 className='text-xs uppercase tracking-wider font-bold text-default-700 mb-2'>
            {t('admin.addons.groupsTitle')}
          </h4>
          <div className='space-y-2'>
            {groups.map((g) => {
              const list = addons.filter(
                (a) => String(a.group_id) === String(g.id)
              );
              return (
                <div key={g.id} className='min-w-0'>
                  <div className='flex items-center gap-1.5 flex-wrap mb-1'>
                    <span className='text-sm font-semibold truncate'>
                      {localName(g)}
                    </span>
                    <Chip
                      size='sm'
                      variant='solid'
                      color={g.is_required ? 'warning' : 'default'}
                      className='font-semibold'
                    >
                      {g.is_required ? t('common.required') : t('common.optional')}
                    </Chip>
                    {g.max_select && Number(g.max_select) > 0 && (
                      <Chip size='sm' variant='solid'>
                        {t('opts.maxChoices', { n: String(g.max_select) })}
                      </Chip>
                    )}
                  </div>
                  {list.length === 0 ? (
                    <div className='text-xs font-medium text-default-700'>
                      {t('admin.addons.noneInGroup')}
                    </div>
                  ) : (
                    <ul className='space-y-0.5 ps-3'>
                      {list.map((a) => (
                        <li
                          key={a.id}
                          className='flex items-center justify-between gap-2 text-xs'
                        >
                          <span className='truncate'>{localName(a)}</span>
                          <span className='money whitespace-nowrap font-medium'>
                            {money(a.price)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
