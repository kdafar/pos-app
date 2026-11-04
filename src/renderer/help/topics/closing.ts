import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const closing: HelpTopicDef = {
  id: 'closing',
  icon: 'closing',
  steps: [
    { id: 'read', screen: '/reports/closing' },
    { id: 'print', screen: '/reports/closing', picture: { file: 'closing' } },
  ],
};
