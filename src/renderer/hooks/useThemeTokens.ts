import { useTheme } from '../../context/ThemeContext';
import { tokens } from '../ui/theme';

export function useThemeTokens() {
  const { theme } = useTheme();
  return { theme, t: tokens(theme) };
}
