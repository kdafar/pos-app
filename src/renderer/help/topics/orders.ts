import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const orders: HelpTopicDef = {
  id: 'orders',
  icon: 'orders',
  steps: [
    { id: 'find', screen: '/orders', picture: { file: 'orders' } },
    { id: 'details', screen: '/orders' },
    { id: 'status', screen: '/orders', requires: ['orders.change_status'] },
  ],
};
