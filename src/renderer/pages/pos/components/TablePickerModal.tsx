// components/TablePickerModal.tsx
import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tab,
  Tabs,
} from '@heroui/react';
import { RotateCw } from 'lucide-react';
import { Hint } from '../../../components/Hint';
import { TableInfo, TableStatus, Order } from '../types';
import { DataState } from '../../../components/PageShell';
import { useI18n } from '../../../i18n';
import { floorsOf, initialFloor, NO_FLOOR, onFloor } from '../tableFloors';

import { errorLine as errLine } from '../../../utils/posError';
/**
 * Table status has exactly one meaning per colour, taken from the semantic
 * scale so both themes get correct contrast from one definition. The previous
 * version carried six hand-mixed emerald/amber/rose tints behind a
 * `theme === 'dark'` branch, which meant every status had two chances to be
 * wrong and the light variants (`bg-success/15`, `bg-rose-100`) were unreadable
 * whenever the dark theme actually rendered them.
 */
const STATUS_COLOR: Record<TableStatus, 'success' | 'warning' | 'danger'> = {
  available: 'success',
  reserved: 'warning',
  occupied: 'danger',
};

const STATUS_DOT: Record<TableStatus, string> = {
  available: 'bg-[var(--st-green)]',
  reserved: 'bg-[var(--st-amber)]',
  occupied: 'bg-[var(--st-red)]',
};

export function TablePickerModal({
  tables,
  current,
  onClose,
  onAssign,
  onRefresh,
}: {
  tables: TableInfo[];
  current: Order;
  /**
   * Unused — every colour here is a semantic token that resolves itself in both
   * themes. Kept declared and optional only because OrderSide.tsx still passes
   * it; it can go when that call site is migrated.
   */
  theme?: 'light' | 'dark';
  onClose: () => void;
  onAssign: (t: TableInfo, covers: number) => void;
  /** Widened to allow awaiting: the caller's refresh is async and can fail. */
  onRefresh: () => void | Promise<void>;
}) {
  const [covers, setCovers] = useState<number>(current.covers || 2);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, lang } = useI18n();
  // One tab per floor. Opens on the floor holding this order's table, so
  // moving a party starts from where they are sitting.
  const floors = useMemo(() => floorsOf(tables), [tables]);
  const [picked, setFloor] = useState(() =>
    initialFloor(floors, tables, current.table_id)
  );
  // A refresh can remove the floor that was open; fall back to the first.
  const floor = floors.some((f) => f.key === picked) ? picked : floors[0]?.key ?? NO_FLOOR;
  const visible = floors.length
    ? tables.filter((tbl) => onFloor(tbl, floor))
    : tables;
  const statusLabel = (s: TableStatus) =>
    s === 'available'
      ? t('tables.available')
      : s === 'reserved'
      ? t('tables.reserved')
      : t('tables.occupied');

  /**
   * Refresh used to be fire-and-forget: if the tables query failed, the button
   * stopped spinning and the grid silently kept stale seating — which is the
   * one thing this modal must never do mid-service. Now the failure is shown
   * with the real message and a retry.
   */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await onRefresh();
    } catch (e) {
      setError(errLine(e));
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const legend: TableStatus[] = ['available', 'reserved', 'occupied'];

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
            <ModalHeader className='flex flex-col gap-2'>
              <span className='text-lg font-semibold ink'>
                {t('tables.assign')}
              </span>
              {/* The legend is the key to the whole grid, so it is a solid
                  default-600 at readable size rather than an 11px whisper. */}
              <div className='flex flex-wrap items-center gap-4 text-xs font-medium ink-2'>
                {legend.map((s) => (
                  <span key={s} className='flex items-center gap-1.5'>
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[s]}`}
                    />
                    {statusLabel(s)}
                  </span>
                ))}
              </div>
            </ModalHeader>

            <ModalBody className='gap-4 overflow-y-auto'>
              <div className='flex flex-wrap items-end justify-between gap-3'>
                <Input
                  type='number'
                  min={1}
                  label={t('tables.covers')}
                  labelPlacement='outside'
                  value={String(covers)}
                  onValueChange={(v) => setCovers(Math.max(1, Number(v || 1)))}
                  classNames={{
                    inputWrapper: 'ui-input',
                    input: 'money text-base font-semibold',
                    label: 'text-sm font-semibold ink-2',
                  }}
                  className='w-32'
                  aria-label={t('tables.covers')}
                />
                <Button
                  variant='bordered'
                  size='lg'
                  className='rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                  onPress={handleRefresh}
                  isLoading={refreshing}
                  startContent={!refreshing && <RotateCw size={18} strokeWidth={1.8} />}
                >
                  {t('tables.refresh')}
                </Button>
              </div>

              {floors.length > 0 && (
                <Tabs
                  classNames={{ base: 'max-w-full', tabList: 'max-w-full overflow-x-auto chip-scroll' }}
                  aria-label={t('tables.floor')}
                  selectedKey={floor}
                  onSelectionChange={(k) => setFloor(String(k))}
                  size='lg'
                >
                  {floors.map((f) => (
                    <Tab
                      key={f.key}
                      title={
                        f.key === NO_FLOOR
                          ? t('tables.noFloor')
                          : lang === 'ar'
                          ? f.nameAr
                          : f.nameEn
                      }
                    />
                  ))}
                </Tabs>
              )}

              {current.table_id && (
                <p className='text-sm font-medium ink-2'>
                  {t('tables.tip')}
                </p>
              )}

              <DataState
                // Only blank the grid when there is nothing to blank: ripping
                // the seating away on every refresh is worse than a stale tile
                // for a second.
                loading={refreshing && tables.length === 0}
                error={error}
                onRetry={handleRefresh}
                empty={visible.length === 0}
                emptyTitle={t('tables.none')}
              >
                <div className='grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3'>
                  {/* `tbl`, not `t` — `t` is the translator in this scope. */}
                  {visible.map((tbl) => {
                    const isCurrent = current.table_id === tbl.id;
                    // 🔑 Only disable when not current AND not available
                    const disabled = !isCurrent && tbl.status !== 'available';

                    return (
                      <Hint
                        key={tbl.id}
                        placement='top'
                        content={t('tables.seatsTitle', {
                          name: lang === 'ar' && tbl.name_ar ? tbl.name_ar : tbl.name,
                          seats: tbl.seats || 0,
                        })}
                      >
                      <button
                        type='button'
                        onClick={() => {
                          if (!disabled) onAssign(tbl, covers);
                        }}
                        disabled={disabled}
                        aria-label={t('tables.seatsTitle', {
                          name: lang === 'ar' && tbl.name_ar ? tbl.name_ar : tbl.name,
                          seats: tbl.seats || 0,
                        })}
                        // An unavailable tile is not faded — a cashier scanning
                        // the floor still has to read "Occupied" from arm's
                        // length. It is the surface and the cursor that say
                        // "not this one", never the contrast.
                        className={`flex min-h-28 w-full flex-col justify-between rounded-[16px] border p-3 text-start transition
                          ${
                            isCurrent
                              ? 'border-2 border-[var(--brand)] shadow-[0_0_0_4px_var(--brand-ring)]'
                              : 'border-line-strong'
                          }
                          ${
                            disabled
                              ? 'cursor-not-allowed bg-surface-2'
                              : 'bg-surface hover:border-[var(--brand)] hover:shadow-[var(--shadow-1)]'
                          }`}
                      >
                        <div className='flex items-start justify-between gap-2'>
                          <div className='min-w-0 flex-1'>
                            <div className='truncate text-base font-semibold ink'>
                              {lang === 'ar' && tbl.name_ar ? tbl.name_ar : tbl.name}
                            </div>
                            <div className='mt-1 text-sm font-medium ink-2'>
                              {t('tables.seats')}:{' '}
                              <span className='money'>{tbl.seats || 0}</span>
                            </div>
                          </div>
                          <Chip
                            size='sm'
                            variant='solid'
                            color={STATUS_COLOR[tbl.status]}
                            className='shrink-0 font-semibold text-white'
                          >
                            {statusLabel(tbl.status)}
                          </Chip>
                        </div>

                        {isCurrent && (
                          <div className='mt-2 text-xs font-semibold text-[var(--brand-strong)]'>
                            {t('tables.currentlyAssigned')}
                          </div>
                        )}
                      </button>
                      </Hint>
                    );
                  })}
                </div>
              </DataState>
            </ModalBody>

            <ModalFooter className='flex flex-wrap justify-end gap-2 border-t border-line'>
              <Button
                variant='bordered'
                size='lg'
                className='rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                onPress={onClose}
              >
                {t('common.close')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
