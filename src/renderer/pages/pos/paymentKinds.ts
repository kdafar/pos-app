/**
 * Payment slugs that hand the customer a link instead of taking payment at the
 * till. Shared by checkout and the dine-in quick update, which must open the
 * full checkout for these: a new round needs a new link for the new total.
 */
const ONLINE_PAYMENT_SLUGS = [
  'link',
  'myfatoorah',
  'online',
  'online_knet',
  'online_card',
  'mf_online',
];

export const isOnlinePayment = (slug?: string | null) =>
  ONLINE_PAYMENT_SLUGS.includes((slug ?? '').toLowerCase());
