import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const printing: HelpTopicDef = {
  id: 'printing',
  icon: 'printer',
  steps: [
    { id: 'when', screen: '/' },
    { id: 'reprint', screen: '/orders' },
    { id: 'setup-printer', screen: '/settings' },
    { id: 'drawer', screen: '/settings' },
  ],
};
