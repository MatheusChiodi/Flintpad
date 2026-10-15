import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/instrument-sans/wght.css';
import '@fontsource-variable/instrument-sans/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@blocknote/mantine/style.css';
import './styles.css';

import { createRoot } from 'react-dom/client';

import App from './App';
import { I18nProvider } from './lib/i18n';
import { PrefsProvider } from './lib/prefsContext';

// A língua e as preferências vêm do processo principal antes da primeira pintura:
// nada aparece na língua, na cor ou no tamanho errado.
void window.api.getSettings().then(({ language, prefs }) =>
  createRoot(document.getElementById('root')!).render(
    <I18nProvider initial={language}>
      <PrefsProvider initial={prefs}>
        <App />
      </PrefsProvider>
    </I18nProvider>,
  ),
);
