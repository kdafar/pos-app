// src/renderer/components/PageShell.tsx
import type { ReactNode } from 'react';
import { Button, Chip, Input, Select, SelectItem, Spinner } from '@heroui/react';
import { AlertCircle, Inbox, RotateCw, Search, type LucideIcon } from 'lucide-react';
import { useI18n } from '../i18n';

/**
 * The frame every admin page shares — deliberately not a copy of the one they
 * each grew.
 *
 * Two rules drive the styling here, both from how this app is actually used:
 *
 * 1. It is a till. Staff read these mid-transaction with a customer waiting, at
 *    arm's length, often glancing rather than looking. So nothing that carries
 *    meaning is rendered in a light or low-contrast tone, and controls are
 *    sized for a finger, not a mouse pointer. If a thing can be missed, it is
 *    the wrong weight.
 * 2. Both themes ship. Every colour is a HeroUI semantic token (foreground,
 *    default-600, danger, success), never a hard slate-xxx — so dark and light
 *    both get correct contrast from one definition instead of two sets of
 *    classes that drift apart.
 *
 * The layout also drops three things the old header carried: rows-per-page
 * (DataTable owns pagination — two controls for one setting), a prominent
 * "Refresh" button (a workaround for data that does not refresh itself), and
 * the habit of burying the primary action among the filters, which made the
 * main reason to open the page its least visible element.
 */
export function PageShell({
  title,
  subtitle,
  count,
  primaryAction,
  filters,
  onRefresh,
  refreshing,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Row count, shown beside the title so the page states its own size. */
  count?: number;
  primaryAction?: ReactNode;
  filters?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    // Padding scales with the window: a 13" screen should not spend its margins
    // on whitespace, and a 4K one should not run text the full width.
    <div className='mx-auto w-full max-w-[110rem] p-3 sm:p-4 lg:p-6 min-w-0'>
      <header className='mb-4 flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2.5 min-w-0'>
            <h1 className='text-xl sm:text-2xl font-bold tracking-tight truncate text-foreground'>
              {title}
            </h1>
            {typeof count === 'number' && (
              <Chip size='sm' color='primary' variant='flat' className='shrink-0 font-semibold'>
                <span className='money'>{count}</span>
              </Chip>
            )}
          </div>
          {subtitle && (
            <p className='text-sm font-medium text-default-600 mt-0.5'>
              {subtitle}
            </p>
          )}
        </div>

        <div className='flex items-center gap-2 shrink-0'>
          {onRefresh && (
            // `flat`, not `light`: a ghost button on a busy screen reads as
            // decoration, and this one is occasionally the fix when another
            // till has just changed the data.
            <Button
              isIconOnly
              variant='flat'
              onPress={onRefresh}
              isLoading={refreshing}
              aria-label={t('admin.refresh')}
              title={t('admin.refresh')}
            >
              {!refreshing && <RotateCw size={18} />}
            </Button>
          )}
          {primaryAction}
        </div>
      </header>

      {filters && (
        <div className='mb-3 flex flex-wrap items-center gap-2 min-w-0'>
          {filters}
        </div>
      )}

      {children}
    </div>
  );
}

/**
 * One place that decides what a page shows when it has nothing to show.
 *
 * Every page hand-rolled this as a faint grey line inside the table body, so a
 * failed load and an empty table looked identical — and both looked like the
 * page was still working. They are different situations, only one has a fix the
 * operator can act on, and neither should be whispered.
 */
export function DataState({
  loading,
  error,
  empty,
  emptyTitle,
  emptyHint,
  action,
  onRetry,
  children,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  /** Offered alongside an empty state — usually the same primary action. */
  action?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className='flex flex-col items-center justify-center gap-3 py-16'>
        <Spinner size='lg' />
        <span className='text-base font-medium text-default-600'>
          {t('common.loading')}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex flex-col items-center justify-center gap-3 py-16 text-center px-4'>
        <AlertCircle size={32} className='text-danger' />
        <div className='max-w-md'>
          <div className='text-lg font-bold text-danger'>
            {t('admin.loadFailed')}
          </div>
          {/* The real message, not a generic apology — it is usually the only
              clue anyone gets when a till misbehaves. */}
          <div className='text-sm font-medium text-default-700 mt-1 break-words'>
            {error}
          </div>
        </div>
        {onRetry && (
          <Button color='danger' variant='flat' onPress={onRetry}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className='flex flex-col items-center justify-center gap-3 py-16 text-center px-4'>
        <Inbox size={32} className='text-default-500' />
        <div>
          <div className='text-lg font-bold text-foreground'>
            {emptyTitle ?? t('admin.noData')}
          </div>
          {emptyHint && (
            <div className='text-sm font-medium text-default-600 mt-1'>
              {emptyHint}
            </div>
          )}
        </div>
        {action}
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Search box.
 *
 * Full size rather than `sm`: this is the control staff hit most on every admin
 * page, and a 32px target is a mouse control, not a till one.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Input
      value={value}
      onValueChange={onChange}
      placeholder={placeholder ?? t('common.search')}
      startContent={<Search size={17} className='text-default-500' />}
      isClearable
      onClear={() => onChange('')}
      className={`w-full sm:w-64 lg:w-80 ${className}`}
      aria-label={placeholder ?? t('common.search')}
    />
  );
}

/**
 * A dropdown filter.
 *
 * Carries a visible label rather than only a placeholder: a filter silently set
 * to something other than "All" is how an operator concludes a record has been
 * deleted when it is merely filtered out.
 */
export function FilterSelect({
  value,
  onChange,
  options,
  label,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <Select
      label={label}
      labelPlacement='outside-left'
      classNames={{ label: 'text-sm font-semibold text-default-700 self-center' }}
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0];
        if (next != null) onChange(String(next));
      }}
      aria-label={label}
      className={`w-full sm:w-44 ${className}`}
    >
      {options.map((o) => (
        <SelectItem key={o.value}>{o.label}</SelectItem>
      ))}
    </Select>
  );
}

/**
 * A headline figure.
 *
 * Replaces four differently-coloured gradient panels that shared a pattern:
 * white text on a saturated wash, the label at opacity-90 and the icon at
 * opacity-40. Faded white on a mid-tone gradient is the least legible thing you
 * can put on a screen someone reads at a glance — and the four colours meant
 * nothing, since blue, purple, orange and green were assigned by position
 * rather than by what the number said.
 *
 * Here the surface stays neutral and the accent carries the meaning: `danger`
 * for cancellations, `success` for takings. The label is a solid tone at full
 * opacity, never a tinted white.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
}) {
  const accent = {
    default: 'text-default-600 border-default-300',
    primary: 'text-primary border-primary',
    success: 'text-success border-success',
    warning: 'text-warning border-warning',
    danger: 'text-danger border-danger',
  }[tone];

  return (
    // The accent is a border and an icon, not a fill: a page of four saturated
    // blocks makes every figure shout, so none of them stands out.
    <div
      className={`rounded-lg border border-default-200 border-s-4 ${accent.split(' ')[1]}
        bg-content1 p-4 flex items-start justify-between gap-3 min-w-0`}
    >
      <div className='min-w-0'>
        <div className='text-sm font-semibold text-default-700 mb-1 truncate'>
          {label}
        </div>
        <div className='text-2xl xl:text-3xl font-bold text-foreground money'>
          {value}
        </div>
      </div>
      {Icon && (
        <Icon size={26} className={`shrink-0 ${accent.split(' ')[0]}`} />
      )}
    </div>
  );
}
