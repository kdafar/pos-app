import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const tables: HelpTopicDef = {
  id: 'tables',
  icon: 'table',
  steps: [
    { id: 'seat', screen: '/', picture: { file: 'table-picker' } },
    { id: 'send', screen: '/' },
    { id: 'more', screen: '/' },
    { id: 'move', screen: '/' },
    { id: 'release', screen: '/' },
  ],
};
