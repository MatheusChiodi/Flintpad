import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_PREFS, prefsToRoot, sanitizePrefs, type Prefs } from './prefs';

const PrefsContext = createContext<{ prefs: Prefs; setPrefs: (change: Partial<Prefs>) => void; resetPrefs: () => void }>({
  prefs: DEFAULT_PREFS,
  setPrefs: () => {},
  resetPrefs: () => {},
});

// Aplica cor de destaque, tamanho da fonte e movimento na raiz do documento.
function applyToRoot(prefs: Prefs) {
  const root = document.documentElement;
  const { vars, attrs } = prefsToRoot(prefs);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
}

export function PrefsProvider({ initial, children }: { initial: unknown; children: ReactNode }) {
  const [prefs, setState] = useState(() => sanitizePrefs(initial));

  // Antes da pintura: a primeira tela já sai com a cor e a fonte escolhidas.
  useLayoutEffect(() => applyToRoot(prefs), [prefs]);

  const value = useMemo(() => {
    const save = (next: Prefs) => {
      setState(next);
      // O processo principal grava em config.json (e liga/desliga o corretor). Uma falha vale só nesta sessão.
      window.api.setSettings({ prefs: next }).catch((error) => console.error('settings:set', error));
    };
    return {
      prefs,
      setPrefs: (change: Partial<Prefs>) => save(sanitizePrefs({ ...prefs, ...change })),
      resetPrefs: () => save(DEFAULT_PREFS),
    };
  }, [prefs]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);
