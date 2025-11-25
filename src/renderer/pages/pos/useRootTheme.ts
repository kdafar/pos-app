// useRootTheme.ts
import { useEffect, useState } from 'react';

export function useRootTheme(): 'light' | 'dark' {
  const [t, setT] = useState<'light' | 'dark'>(
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );

  useEffect(() => {
    const mo = new MutationObserver(() =>
      setT(
        document.documentElement.classList.contains('dark') ? 'dark' : 'light'
      )
    );
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  return t;
}
