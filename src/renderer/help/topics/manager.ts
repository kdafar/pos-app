import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const manager: HelpTopicDef = {
  id: 'manager',
  icon: 'manager',
  steps: [
    { id: 'language' },
    { id: 'text-size', screen: '/settings' },
    { id: 'clear-table', screen: '/tables' },
    { id: 'update', screen: '/updates' },
    { id: 'permissions', screen: '/permissions' },
    {
      id: 'lists',
      screen: ['/categories', '/items', '/promos', '/payment-methods', '/locations'],
    },
    { id: 'repair', screen: '/settings' },
    { id: 'unpair', screen: '/settings' },
  ],
};
