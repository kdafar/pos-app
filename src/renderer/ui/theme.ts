import type { Theme } from '../context/ThemeContext';

export function tokens(theme: Theme) {
  return {
    // layout
    bg: theme === 'dark' ? 'bg-slate-950' : 'bg-gray-50',
    headerBg: theme === 'dark' ? 'bg-slate-900/70' : 'bg-white/70',
    border: theme === 'dark' ? 'border-white/5' : 'border-gray-200',

    // text
    text: theme === 'dark' ? 'text-white' : 'text-gray-900',
    textMuted: theme === 'dark' ? 'text-slate-400' : 'text-gray-600',

    // surfaces
    cardBg: theme === 'dark' ? 'bg-white/5' : 'bg-white',
    cardBorder: theme === 'dark' ? 'border-white/10' : 'border-gray-200',
    inputBg: theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-gray-300',

    // accents
    accent: theme === 'dark' ? 'text-blue-300' : 'text-blue-600',

    // small helpers for segmented controls
    segBg: theme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-gray-100 border-gray-300',
    segActive: theme === 'dark'
      ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow'
      : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow',
    segInactive: theme === 'dark'
      ? 'text-slate-300 hover:text-white'
      : 'text-gray-700 hover:text-gray-900',
  };
}
