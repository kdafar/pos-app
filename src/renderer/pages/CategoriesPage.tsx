import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../src/store';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, Chip } from '@heroui/react';
import { Check, Minus, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { DataTable } from '../components/DataTable';
import {
  DataState,
  FilterSelect,
  PageShell,
  SearchField,
} from '../components/PageShell';

type Category = {
  id: string | number;
  position: number;
  name: string;
  name_ar: string;
  visible: boolean | number;
};

type Subcategory = {
  id: string | number;
  category_id: string | number;
  position: number;
  name: string;
  name_ar: string;
  visible: boolean | number;
};

const norm = (s: any) => String(s ?? '').toLowerCase();
const toBool = (v: any) => (typeof v === 'boolean' ? v : !!Number(v));

/**
 * Visibility decides whether an item appears on the till at all, so it is the
 * reason anyone opens this page — "why can't I find X". A tick and an em dash
 * made those two states nearly identical at a glance; a tone does not.
 */
function VisibleChip({ value }: { value: any }) {
  const { t } = useI18n();
  const on = toBool(value);
  return (
    <Chip
      size='sm'
      variant='flat'
      color={on ? 'success' : 'default'}
      className='font-semibold'
      startContent={on ? <Check size={13} /> : <Minus size={13} />}
    >
      {on ? t('admin.cats.visibleOnly') : t('admin.cats.hiddenOnly')}
    </Chip>
  );
}

/** Shared search + visibility filter, since both halves of this page need it. */
function useVisibilityOptions() {
  const { t } = useI18n();
  return [
    { value: 'all', label: t('common.all') },
    { value: 'visible', label: t('admin.cats.visibleOnly') },
    { value: 'hidden', label: t('admin.cats.hiddenOnly') },
  ];
}

export function CategoriesPage() {
  const { t, name: localName } = useI18n();
  const cats = useStore((s) => s.cats) as Category[] | undefined;
  const fetchInitialData = useStore((s) => s.actions.fetchInitialData);
  const visibilityOptions = useVisibilityOptions();

  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [subcats, setSubcats] = useState<Subcategory[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [subsError, setSubsError] = useState<string | null>(null);

  const [catSearch, setCatSearch] = useState('');
  const [catVisFilter, setCatVisFilter] = useState('all');
  const [subsSearch, setSubsSearch] = useState('');
  const [subsVisFilter, setSubsVisFilter] = useState('all');

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const loadSubs = useCallback(async () => {
    setLoadingSubs(true);
    setSubsError(null);
    try {
      const res: Subcategory[] =
        (await window.api.invoke(
          'catalog:listSubcategories',
          selectedCatId || null
        )) || [];
      setSubcats(res);
    } catch (e) {
      // Was a console.error and an empty array, which renders identically to a
      // category that genuinely has no subcategories.
      setSubsError(e instanceof Error ? e.message : String(e ?? ''));
      setSubcats([]);
    } finally {
      setLoadingSubs(false);
    }
  }, [selectedCatId]);

  useEffect(() => {
    loadSubs();
  }, [loadSubs]);

  const byPositionThenName = <T extends { position: number; name: string }>(
    a: T,
    b: T
  ) =>
    a.position === b.position
      ? norm(a.name).localeCompare(norm(b.name))
      : a.position - b.position;

  const filteredCats = useMemo(() => {
    let arr = (cats ?? []).slice();
    if (catSearch.trim()) {
      const q = norm(catSearch);
      arr = arr.filter(
        (c) => norm(c.name).includes(q) || norm(c.name_ar).includes(q)
      );
    }
    if (catVisFilter !== 'all') {
      const want = catVisFilter === 'visible';
      arr = arr.filter((c) => toBool(c.visible) === want);
    }
    return arr.sort(byPositionThenName);
  }, [cats, catSearch, catVisFilter]);

  const filteredSubcats = useMemo(() => {
    let arr = subcats.slice();
    if (subsSearch.trim()) {
      const q = norm(subsSearch);
      arr = arr.filter(
        (s) => norm(s.name).includes(q) || norm(s.name_ar).includes(q)
      );
    }
    if (subsVisFilter !== 'all') {
      const want = subsVisFilter === 'visible';
      arr = arr.filter((s) => toBool(s.visible) === want);
    }
    return arr.sort(byPositionThenName);
  }, [subcats, subsSearch, subsVisFilter]);

  /** Both tables show the same four things, so they share a column builder. */
  const nameColumns = useMemo<ColumnDef<Category & Subcategory, any>[]>(
    () => [
      {
        accessorKey: 'position',
        header: () => '#',
        size: 60,
        meta: { nowrap: true, align: 'end' },
        cell: (info) => (
          <span className='money text-default-600'>
            {String(info.getValue() ?? '')}
          </span>
        ),
      },
      {
        accessorKey: 'name',
        header: () => t('admin.nameEn'),
        size: 200,
        cell: (info) => (
          <span className='font-semibold'>{String(info.getValue() ?? '')}</span>
        ),
      },
      {
        accessorKey: 'name_ar',
        header: () => t('admin.nameAr'),
        size: 200,
        cell: (info) => String(info.getValue() ?? ''),
      },
      {
        accessorKey: 'visible',
        header: () => t('admin.cats.visible'),
        size: 120,
        meta: { nowrap: true },
        cell: (info) => <VisibleChip value={info.getValue()} />,
      },
    ],
    [t]
  );

  const subsColumns = useMemo<ColumnDef<Subcategory, any>[]>(
    () => [
      ...(nameColumns as ColumnDef<Subcategory, any>[]),
      {
        accessorKey: 'category_id',
        header: () => t('admin.subs.category'),
        size: 200,
        enableSorting: false,
        cell: (info) => {
          const id = String(info.getValue() ?? '');
          const c = (cats ?? []).find((x) => String(x.id) === id);
          return c ? localName(c) : id;
        },
      },
    ],
    [cats, nameColumns, t, localName]
  );

  const selectedCat =
    selectedCatId && cats
      ? cats.find((c) => String(c.id) === String(selectedCatId))
      : null;

  return (
    <PageShell
      title={t('admin.cats.title')}
      subtitle={t('admin.readOnly')}
      count={filteredCats.length}
      onRefresh={() => {
        fetchInitialData();
        loadSubs();
      }}
    >
      <div className='space-y-6'>
        {/* Categories */}
        <section className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <SearchField
              value={catSearch}
              onChange={setCatSearch}
              placeholder={t('admin.cats.searchPlaceholder')}
            />
            <FilterSelect
              label={t('admin.cats.visible')}
              value={catVisFilter}
              onChange={setCatVisFilter}
              options={visibilityOptions}
            />
          </div>

          <DataState
            empty={filteredCats.length === 0}
            emptyTitle={t('admin.cats.none')}
          >
            <DataTable
              data={filteredCats}
              columns={nameColumns as ColumnDef<Category, any>[]}
              getRowId={(r, i) => String(r.id ?? i)}
              // Selecting a category is what filters the list below, so the
              // whole row is the control rather than a hidden affordance.
              onRowClick={(row) => setSelectedCatId(String(row.id))}
            />
          </DataState>
        </section>

        {/* Subcategories */}
        <section className='space-y-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h2 className='text-lg font-bold text-foreground flex items-center gap-2 min-w-0'>
              <span className='truncate'>{t('admin.subs.title')}</span>
              {selectedCat ? (
                // The filter is stated as a removable chip rather than a line of
                // prose plus a separate "show all" button — a filtered list that
                // does not say so is how a subcategory looks deleted.
                <Chip
                  color='primary'
                  variant='flat'
                  className='font-semibold'
                  endContent={
                    <button
                      type='button'
                      onClick={() => setSelectedCatId(null)}
                      aria-label={t('admin.cats.showAllSubs')}
                      title={t('admin.cats.showAllSubs')}
                      className='ms-0.5'
                    >
                      <X size={14} />
                    </button>
                  }
                >
                  {localName(selectedCat)}
                </Chip>
              ) : (
                <Chip variant='flat' className='font-semibold'>
                  {t('admin.subs.all')}
                </Chip>
              )}
            </h2>

            <div className='flex flex-wrap items-center gap-2'>
              <SearchField
                value={subsSearch}
                onChange={setSubsSearch}
                placeholder={t('admin.subs.searchPlaceholder')}
              />
              <FilterSelect
                label={t('admin.cats.visible')}
                value={subsVisFilter}
                onChange={setSubsVisFilter}
                options={visibilityOptions}
              />
            </div>
          </div>

          <DataState
            loading={loadingSubs}
            error={subsError}
            onRetry={loadSubs}
            empty={filteredSubcats.length === 0}
            emptyTitle={t('admin.subs.none')}
            action={
              selectedCat ? (
                <Button
                  color='primary'
                  variant='flat'
                  onPress={() => setSelectedCatId(null)}
                >
                  {t('admin.cats.showAllSubs')}
                </Button>
              ) : undefined
            }
          >
            <DataTable
              data={filteredSubcats}
              columns={subsColumns}
              getRowId={(r, i) => String(r.id ?? i)}
            />
          </DataState>
        </section>
      </div>
    </PageShell>
  );
}
