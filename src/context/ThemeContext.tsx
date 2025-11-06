import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Hook to detect the root <html> element's theme.
 */
function useRootThemeDetector(): Theme {
  const [t, setT] = useState<Theme>(
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );
  
  useEffect(() => {
    const mo = new MutationObserver(() =>
      setT(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    );
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  
  return t;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const detectedTheme = useRootThemeDetector();
  const [theme, setTheme] = useState<Theme>(detectedTheme);

  // Keep state in sync with detector
  useEffect(() => {
    setTheme(detectedTheme);
  }, [detectedTheme]);

  // Manual toggle (if you add a button for it)
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};