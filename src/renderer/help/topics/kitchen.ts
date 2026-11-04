import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const kitchen: HelpTopicDef = {
  id: 'kitchen',
  icon: 'kitchen',
  steps: [
    { id: 'read', screen: '/kitchen', picture: { file: 'kitchen' } },
    { id: 'move', screen: '/kitchen', requires: ['orders.change_status'] },
  ],
};
