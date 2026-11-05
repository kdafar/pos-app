// src/renderer/help/HelpButton.tsx
//
// The small "?" in the top corner of every main screen. It knows nothing about
// the screen it sits on: it opens the guide page with ?from=<this route>, and
// the guide picks the step (SCREEN_HELP in guide.ts) and offers "Go back".
import { Button } from '@heroui/react';
import { CircleHelp } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { Hint } from '../components/Hint';
import { WORDS } from './guide';

/** Before sign-in there is no sidebar; the guide is served without it. */
const SIGNED_OUT_SCREENS = ['/login', '/pair'];

export function HelpButton({ className = '' }: { className?: string }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { lang } = useI18n();
  const label = WORDS[lang].ui.openHelp;
  const page = SIGNED_OUT_SCREENS.includes(pathname) ? '/start-help' : '/help';
  return (
    <Hint content={label} placement='bottom'>
      <Button
        isIconOnly
        variant='light'
        radius='full'
        // A small quiet icon, not a button that competes with the screen's actions.
        className={`h-8 w-8 min-w-8 pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:min-w-10 shrink-0 ink-3 hover:ink ${className}`}
        aria-label={label}
        onPress={() => navigate(`${page}?from=${encodeURIComponent(pathname)}`)}
      >
        <CircleHelp size={18} strokeWidth={1.8} />
      </Button>
    </Hint>
  );
}
