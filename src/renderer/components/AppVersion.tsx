// The installed version, for screens shown before login (Pair, Login), where
// the sidebar's version line is not on screen. Support asks for it first.
import packageJson from '../../../package.json';
import { useI18n } from '../i18n';

export const APP_VERSION: string = packageJson.version;

export function AppVersion({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span className={`text-xs font-medium tabular-nums text-default-700 ${className}`}>
      {t('auth.version', { version: APP_VERSION })}
    </span>
  );
}
