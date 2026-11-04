import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const order: HelpTopicDef = {
  id: 'order',
  icon: 'order',
  steps: [
    { id: 'new-order', screen: '/', picture: { file: 'order-screen' } },
    { id: 'find-dish', screen: '/' },
    { id: 'options', screen: '/', picture: { file: 'options' } },
    { id: 'change-line', screen: '/' },
    { id: 'promo', screen: '/' },
    { id: 'delivery', screen: '/' },
    { id: 'many-orders', screen: '/' },
  ],
};
