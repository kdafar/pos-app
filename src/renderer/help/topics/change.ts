import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const change: HelpTopicDef = {
  id: 'change',
  icon: 'change',
  steps: [
    { id: 'before', screen: '/' },
    { id: 'sent', screen: '/', picture: { file: 'approval' } },
    { id: 'cancel', screen: '/' },
    { id: 'cancel-manager', screen: '/orders', requires: ['orders.change_status'] },
    { id: 'approve', requires: ['orders.approve'] },
  ],
};
