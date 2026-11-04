import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const pay: HelpTopicDef = {
  id: 'pay',
  icon: 'pay',
  steps: [
    { id: 'place', screen: '/', picture: { file: 'checkout' } },
    { id: 'cash', screen: '/', picture: { file: 'cash' } },
    // Marked paid from Recent Orders: a placed pickup leaves the order screen.
    { id: 'knet', screen: '/orders', requires: ['orders.mark_paid'], picture: { file: 'mark-paid' } },
    { id: 'link', screen: '/' },
    { id: 'undo', screen: '/orders', requires: ['orders.mark_paid', 'orders.mark_unpaid'] },
  ],
};
