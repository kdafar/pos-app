import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const start: HelpTopicDef = {
  id: 'start',
  icon: 'start',
  steps: [
    { id: 'sign-in', picture: { file: 'sign-in' } },
    { id: 'check-till', picture: { file: 'check-till' } },
    { id: 'test-print', screen: '/settings' },
    { id: 'pair' },
  ],
};
