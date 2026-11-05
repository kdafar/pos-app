// src/renderer/components/PageShell.tsx
import type { ComponentType, ReactNode } from 'react';
import { Button, Input, Select, SelectItem, Spinner } from '@heroui/react';
import { AlertCircle, Inbox, RotateCw, Search, type LucideIcon } from 'lucide-react';
import { useI18n } from '../i18n';
import { HelpButton } from '../help/HelpButton';
import { Hint } from './Hint';

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
      <header className='mb-4 flex flex-wrap items-center gap-2'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2.5 min-w-0'>
            <h1 className='text-xl font-semibold truncate ink'>
              {title}
            </h1>
            {typeof count === 'number' && (
              <span className='ui-count shrink-0 money'>{count}</span>
            )}
          </div>
          {subtitle && (
            <p className='text-sm ink-2 mt-0.5'>
              {subtitle}
            </p>
          )}
        </div>

        <div className='ms-auto flex flex-wrap items-center justify-end gap-2'>
          {onRefresh && (
            // An outline button, not a ghost: a ghost on a busy screen reads as
            // decoration, and this one is occasionally the fix when another
            // till has just changed the data.
            <Hint content={t('admin.refresh')} placement='bottom'>
              <Button
                isIconOnly
                variant='bordered'
                onPress={onRefresh}
                isLoading={refreshing}
                aria-label={t('admin.refresh')}
                className='border border-[var(--line-strong)] bg-[var(--surface)]'
              >
                {!refreshing && <RotateCw size={20} strokeWidth={1.8} />}
              </Button>
            </Hint>
          )}
          {primaryAction}
          <HelpButton />
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
        <span className='text-base font-medium ink-2'>
          {t('common.loading')}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className='ui-notice flex-wrap items-center gap-3 p-4 max-w-2xl mx-auto my-8'>
        <AlertCircle size={24} strokeWidth={1.8} className='shrink-0 text-danger' />
        <div className='min-w-0 flex-1'>
          <div className='text-base font-semibold ink'>
            {t('admin.loadFailed')}
          </div>
          {/* The real message, not a generic apology — it is usually the only
              clue anyone gets when a till misbehaves. */}
          <div className='text-sm ink-2 mt-0.5 break-words'>
            {error}
          </div>
        </div>
        {onRetry && (
          <Button
            variant='bordered'
            onPress={onRetry}
            className='shrink-0 font-semibold border border-[var(--line-strong)] bg-[var(--surface)]'
          >
            {t('common.retry')}
          </Button>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className='flex flex-col items-center justify-center gap-3 py-16 text-center px-4 rounded-[20px] border border-dashed border-line-strong ink-2'>
        <Inbox size={32} strokeWidth={1.8} />
        <div>
          <div className='text-base font-semibold ink'>
            {emptyTitle ?? t('admin.noData')}
          </div>
          {emptyHint && (
            <div className='text-sm ink-2 mt-1'>
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
      startContent={<Search size={18} strokeWidth={1.8} className='ink-2' />}
      isClearable
      classNames={{ inputWrapper: 'ui-input' }}
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
      classNames={{
        // `outside-left` lays the label and the control out as one flex row,
        // and HeroUI gives the label no `shrink-0`. With the width set on the
        // Select itself, the label wins that row and the control keeps only
        // what is left — which is how "All sources" became "All s..." under a
        // long label like "Filter by source". The width belongs on the control
        // alone, so no label length can eat into it.
        label: 'text-sm font-semibold ink-2 self-center shrink-0 whitespace-nowrap',
        mainWrapper: 'w-full sm:w-44',
        trigger: 'ui-input',
      }}
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0];
        if (next != null) onChange(String(next));
      }}
      aria-label={label}
      className={`w-full sm:w-auto ${className}`}
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
  icon?:
    | LucideIcon
    | ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
}) {
  // The accent is the icon only: a card carries one colour at most, and the
  // surface stays the portal's white card.
  const accent = {
    default: 'ink-2',
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];

  return (
    <div className='ui-card p-4 flex items-start justify-between gap-3 min-w-0'>
      <div className='min-w-0'>
        <div className='text-sm font-semibold ink-2 mb-1 truncate'>
          {label}
        </div>
        <div className='text-2xl xl:text-3xl font-bold ink money'>
          {value}
        </div>
      </div>
      {Icon && (
        <Icon size={26} strokeWidth={1.8} className={`shrink-0 ${accent}`} />
      )}
    </div>
  );
}
