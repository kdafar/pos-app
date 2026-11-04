import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const trouble: HelpTopicDef = {
  id: 'trouble',
  icon: 'trouble',
  kind: 'trouble',
  steps: [
    { id: 'printer' },
    { id: 'offline' },
    { id: 'missing-order' },
    { id: 'menu' },
    { id: 'payment' },
    { id: 'drawer' },
    { id: 'sign-in' },
  ],
};
