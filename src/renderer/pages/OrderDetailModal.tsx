// src/renderer/pages/OrderDetailModal.tsx
import { useEffect, useState } from 'react';
import { X, MapPin, User, Clock, Receipt, CreditCard } from 'lucide-react';
import { useI18n, useOrderTypeLabel, useStatusLabel } from '../i18n';
import { PaymentBadge } from '../components/PaymentBadge';

/**
 * Everything one order holds: customer, address, items, totals, payment state
 * and a timeline of what happened when.
 *
 * The timeline reads pos_action_log, which the app has written since long
 * before this screen existed but never displayed — so "when was this printed",
 * "who closed it" had no answer on the till.
 */
export function OrderDetailModal({
  orderId,
  theme,
  onClose,
  onShowQr,
}: {
  orderId: string;
  theme: 'light' | 'dark';
  onClose: () => void;
  onShowQr?: (orderId: string) => void;
}) {
  const { t, name: localName, money, lang } = useI18n();
  const typeLabel = useOrderTypeLabel();
  const statusLabel = useStatusLabel();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const dark = theme === 'dark';
  const bg = dark ? 'bg-slate-900' : 'bg-white';
  const text = dark ? 'text-white' : 'text-gray-900';
  const muted = dark ? 'text-slate-400' : 'text-gray-600';
  const border = dark ? 'border-white/10' : 'border-gray-200';
  const panel = dark ? 'bg-white/5' : 'bg-gray-50';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await window.api.invoke('orders:getDetail', orderId);
        if (!cancelled) {
          if (!d) setError(t('admin.orders.detailMissing'));
          else setData(d);
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : String(e ?? ''));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, t]);

  const when = (ms?: number | null) =>
    ms
      ? new Date(ms).toLocaleString(lang === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB')
      : '—';

  const o = data?.order;
  const geoLine = [
    data?.geo?.state,
    data?.geo?.city,
    data?.geo?.block,
  ]
    .filter(Boolean)
    .map((g: any) => (lang === 'ar' ? g.name_ar || g.name : g.name))
    .join(' — ');

  const Section = ({
    icon: Icon,
    title,
    children,
  }: {
    icon: any;
    title: string;
    children: React.ReactNode;
  }) => (
    <div className={`rounded-xl border ${border} ${panel} p-3.5 space-y-2`}>
      <div
        className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] ${muted}`}
      >
        <Icon size={13} />
        {title}
      </div>
      {children}
    </div>
  );

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm px-3'>
      <div
        className={`${bg} ${border} border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden`}
      >
        <div
          className={`flex items-start justify-between px-5 py-4 border-b ${border}`}
        >
          <div className='space-y-1'>
            <div className={`text-[11px] uppercase tracking-[0.14em] ${muted}`}>
              {t('admin.orders.detailTitle')}
            </div>
            <div className={`text-lg font-semibold ${text} flex items-center gap-2`}>
              {o?.reference_no ? `#${o.reference_no}` : o?.number ?? orderId}
              {o && <PaymentBadge status={o.payment_link_status} theme={theme} />}
            </div>
            {o?.reference_no && (
              <div className={`text-[11px] ${muted} ltr`} dir='ltr'>
                {o.number}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className={`rounded-full p-1.5 ${
              dark ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-gray-100 text-gray-600'
            }`}
          >
            <X size={18} />
          </button>
        </div>

        <div className='flex-1 overflow-y-auto nice-scroll p-4 sm:p-5 space-y-3'>
          {error && (
            <div className='rounded-lg px-3 py-2 text-sm bg-rose-50 text-rose-800 border border-rose-200'>
              {error}
            </div>
          )}
          {!data && !error && (
            <div className={`text-center py-10 ${muted} text-sm`}>
              {t('common.loading')}
            </div>
          )}

          {data && (
            <>
              {data.isServerSeed && (
                <div
                  className={`rounded-lg px-3 py-2 text-xs ${
                    dark
                      ? 'bg-amber-500/10 text-amber-200 border border-amber-500/30'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {t('admin.orders.seedOnly')}
                </div>
              )}

              <div className='grid gap-3 sm:grid-cols-2'>
                <Section icon={User} title={t('cust.customer')}>
                  <div className={`text-sm ${text}`}>{o.full_name || '—'}</div>
                  <div className={`text-xs ${muted} ltr`} dir='ltr'>
                    {o.mobile || '—'}
                  </div>
                  {o.email && (
                    <div className={`text-xs ${muted} ltr`} dir='ltr'>
                      {o.email}
                    </div>
                  )}
                </Section>

                <Section icon={Receipt} title={t('admin.orders.summary')}>
                  <div className={`text-sm ${text}`}>
                    {typeLabel(o.order_type)} · {statusLabel(o.status)}
                  </div>
                  <div className={`text-xs ${muted}`}>
                    {t('admin.orders.placedAt')}: {when(o.opened_at)}
                  </div>
                  {o.table_name && (
                    <div className={`text-xs ${muted}`}>
                      {t('cust.table')}: {o.table_name}
                    </div>
                  )}
                </Section>

                <Section icon={MapPin} title={t('cust.address')}>
                  <div className={`text-sm ${text}`}>{geoLine || '—'}</div>
                  {o.address && (
                    <div className={`text-xs ${muted}`}>{o.address}</div>
                  )}
                  {o.landmark && (
                    <div className={`text-xs ${muted}`}>{o.landmark}</div>
                  )}
                </Section>

                <Section icon={CreditCard} title={t('cust.paymentMethod')}>
                  <div className={`text-sm ${text}`}>
                    {data.payment.method_slug || '—'}
                  </div>
                  {data.payment.link_url && (
                    <button
                      onClick={() => onShowQr?.(orderId)}
                      className='text-xs underline underline-offset-2 text-blue-600 dark:text-blue-300'
                    >
                      {t('admin.orders.showQr')}
                    </button>
                  )}
                  {data.payment.verified_at && (
                    <div className={`text-xs ${muted}`}>
                      {when(data.payment.verified_at)}
                    </div>
                  )}
                </Section>
              </div>

              {/* Items */}
              <div className={`rounded-xl border ${border} overflow-hidden`}>
                <table className='w-full text-sm'>
                  <thead>
                    <tr className={`${panel} ${muted} text-[11px] uppercase`}>
                      <th className='text-start px-3 py-2'>{t('opts.variation')}</th>
                      <th className='text-start px-3 py-2'>{t('common.qty')}</th>
                      <th className='text-start px-3 py-2'>{t('common.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.length === 0 && (
                      <tr>
                        <td colSpan={3} className={`px-3 py-4 text-center ${muted}`}>
                          {t('cart.empty')}
                        </td>
                      </tr>
                    )}
                    {data.lines.map((l: any) => (
                      <tr key={l.id} className={`border-t ${border}`}>
                        <td className={`px-3 py-2 ${text}`}>
                          {localName(l)}
                          {l.variation && (
                            <span className={`ms-1 text-xs ${muted}`}>
                              [{l.variation}]
                            </span>
                          )}
                          {l.addons_name && (
                            <div className={`text-xs ${muted}`}>+ {l.addons_name}</div>
                          )}
                          {l.notes && (
                            <div className={`text-xs italic ${muted}`}>{l.notes}</div>
                          )}
                        </td>
                        <td className='px-3 py-2 money'>{l.qty}</td>
                        <td className='px-3 py-2 money'>{money(l.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className={`rounded-xl border ${border} ${panel} p-3.5 space-y-1 text-sm`}>
                {[
                  [t('cart.subtotal'), o.subtotal],
                  [t('cart.discount'), o.discount_total],
                  [t('cart.deliveryFee'), o.delivery_fee],
                ].map(([label, val]: any) => (
                  <div key={label} className={`flex justify-between ${muted}`}>
                    <span>{label}</span>
                    <span className='money'>{money(val)}</span>
                  </div>
                ))}
                <div className={`flex justify-between font-semibold ${text} pt-1 border-t ${border}`}>
                  <span>{t('cart.grandTotal')}</span>
                  <span className='money'>{money(o.grand_total)}</span>
                </div>
              </div>

              {/* Timeline */}
              <Section icon={Clock} title={t('admin.orders.timeline')}>
                {data.timeline.length === 0 ? (
                  <div className={`text-xs ${muted}`}>
                    {t('admin.orders.noHistory')}
                  </div>
                ) : (
                  <ol className='space-y-1.5'>
                    {data.timeline.map((e: any, i: number) => (
                      <li key={i} className='flex items-start gap-2 text-xs'>
                        <span
                          className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                            dark ? 'bg-blue-400' : 'bg-blue-600'
                          }`}
                        />
                        <span className={text}>
                          {t(`admin.act.${e.action}` as any) !==
                          `admin.act.${e.action}`
                            ? t(`admin.act.${e.action}` as any)
                            : e.action}
                        </span>
                        <span className={`${muted} ms-auto ltr`} dir='ltr'>
                          {when(e.at)}
                        </span>
                        {e.user && <span className={muted}>· {e.user}</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
            </>
          )}
        </div>

        <div className={`px-5 py-3 border-t ${border} flex justify-end`}>
          <button
            onClick={onClose}
            className='px-4 h-9 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white'
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
