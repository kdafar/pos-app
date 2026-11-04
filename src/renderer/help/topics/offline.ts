import type { HelpTopicDef } from '../types';

// Each step names the sidebar screen it is about; it shows only to users who
// have that screen in their sidebar (SCREEN_PERMISSION in guide.ts).
export const offline: HelpTopicDef = {
  id: 'offline',
  icon: 'offline',
  steps: [
    { id: 'works' },
    { id: 'waiting' },
    { id: 'send-now' },
  ],
};
