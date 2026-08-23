// components/TablePickerModal.tsx
import { useCallback, useState } from 'react';
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@heroui/react';
import { RotateCw } from 'lucide-react';
import { TableInfo, TableStatus, Order } from '../types';
import { DataState } from '../../../components/PageShell';
import { useI18n } from '../../../i18n';

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

const STATUS_BORDER: Record<TableStatus, string> = {
  available: 'border-success',
  reserved: 'border-warning',
  occupied: 'border-danger',
};

const STATUS_DOT: Record<TableStatus, string> = {
  available: 'bg-success',
  reserved: 'bg-warning',
  occupied: 'bg-danger',
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
  const { t } = useI18n();
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
      backdrop='blur'
      scrollBehavior='inside'
      className='rounded-2xl'
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className='flex flex-col gap-2'>
              <span className='text-lg font-bold text-foreground'>
                {t('tables.assign')}
              </span>
              {/* The legend is the key to the whole grid, so it is a solid
                  default-600 at readable size rather than an 11px whisper. */}
              <div className='flex flex-wrap items-center gap-4 text-xs font-medium text-default-700'>
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

            <ModalBody className='gap-4'>
              <div className='flex flex-wrap items-end justify-between gap-3'>
                <Input
                  type='number'
                  min={1}
                  label={t('tables.covers')}
                  labelPlacement='outside'
                  value={String(covers)}
                  onValueChange={(v) => setCovers(Math.max(1, Number(v || 1)))}
                  classNames={{
                    input: 'money text-base font-semibold',
                    label: 'text-sm font-semibold text-default-700',
                  }}
                  className='w-32'
                  aria-label={t('tables.covers')}
                />
                <Button
                  variant='flat'
                  size='lg'
                  onPress={handleRefresh}
                  isLoading={refreshing}
                  startContent={!refreshing && <RotateCw size={18} />}
                >
                  {t('tables.refresh')}
                </Button>
              </div>

              {current.table_id && (
                <p className='text-sm font-medium text-default-700'>
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
                empty={tables.length === 0}
                emptyTitle={t('tables.none')}
              >
                <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
                  {/* `tbl`, not `t` — `t` is the translator in this scope. */}
                  {tables.map((tbl) => {
                    const isCurrent = current.table_id === tbl.id;
                    // 🔑 Only disable when not current AND not available
                    const disabled = !isCurrent && tbl.status !== 'available';

                    return (
                      <button
                        key={tbl.id}
                        type='button'
                        onClick={() => {
                          if (!disabled) onAssign(tbl, covers);
                        }}
                        disabled={disabled}
                        title={t('tables.seatsTitle', {
                          name: tbl.name,
                          seats: tbl.seats || 0,
                        })}
                        // An unavailable tile is not faded — a cashier scanning
                        // the floor still has to read "Occupied" from arm's
                        // length. It is the surface and the cursor that say
                        // "not this one", never the contrast.
                        className={`flex min-h-28 flex-col justify-between rounded-xl border-2 p-3 text-start transition
                          ${STATUS_BORDER[tbl.status]}
                          ${
                            disabled
                              ? 'cursor-not-allowed bg-default-100'
                              : 'bg-content1 hover:-translate-y-0.5 hover:bg-default-100 hover:shadow-sm'
                          }
                          ${
                            isCurrent
                              ? 'ring-2 ring-primary ring-offset-2 ring-offset-content1'
                              : ''
                          }`}
                      >
                        <div className='flex items-start justify-between gap-2'>
                          <div className='min-w-0 flex-1'>
                            <div className='truncate text-base font-semibold text-foreground'>
                              {tbl.name}
                            </div>
                            <div className='mt-1 text-sm font-medium text-default-700'>
                              {t('tables.seats')}:{' '}
                              <span className='money'>{tbl.seats || 0}</span>
                            </div>
                          </div>
                          <Chip
                            size='sm'
                            variant='flat'
                            color={STATUS_COLOR[tbl.status]}
                            className='shrink-0 font-semibold'
                          >
                            {statusLabel(tbl.status)}
                          </Chip>
                        </div>

                        {isCurrent && (
                          <div className='mt-2 text-xs font-semibold text-primary'>
                            {t('tables.currentlyAssigned')}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </DataState>
            </ModalBody>

            <ModalFooter>
              <Button variant='flat' size='lg' onPress={onClose}>
                {t('common.close')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
