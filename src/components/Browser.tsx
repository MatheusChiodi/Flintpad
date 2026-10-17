import '../browser.css';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { setBrowserMenuHandler } from '../lib/browserBridge';
import { BROWSER_SHORTCUTS, comboOf, displayUrl, engineById, hostOf, INTERNAL, isInternal, originOf, resolveInput, SEARCH_ENGINES, searchUrl, suggest, topSites, type Suggestion } from '../lib/browser';
import { useT, type Key } from '../lib/i18n';
import type { BrowserBookmark, BrowserDownload, BrowserPermissionRequest, BrowserVisit, MenuAction } from '../types';
import { ContextMenu, type MenuItem, type MenuRequest } from './ContextMenu';

// Guia Navegador: um Chrome dentro do Flintpad. Cada guia é um <webview> (o Chromium do Electron);
// a barra de endereço, as guias, favoritos, histórico, downloads e permissões são desenhados aqui.
// O processo principal (electron/browser.cjs) cuida das sessões, do menu de contexto e dos atalhos dentro da página.

const NORMAL_PARTITION = 'persist:flintpad-browser';
const INCOGNITO_PARTITION = 'flintpad-incognito';
const SESSION_KEY = 'flintpad.browser.session';
const PREFS_KEY = 'flintpad.browser.prefs';
const ZOOM_KEY = 'flintpad.browser.zoom';
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const MAX_CLOSED = 25;

type WebviewElement = HTMLElement & {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadIgnoringCache(): void;
  stop(): void;
  print(options?: object): Promise<void>;
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): number;
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void;
  setZoomFactor(factor: number): void;
  setAudioMuted(muted: boolean): void;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  getWebContentsId(): number;
  focus(): void;
};

type Tab = {
  id: string;
  /** Endereço atual (o da página, ou flintpad://... nas páginas internas). */
  url: string;
  /** Endereço com que o webview foi criado: mudar não recarrega; webKey novo cria outro webview. */
  initial: string;
  webKey: number;
  title: string;
  favicon: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  incognito: boolean;
  audible: boolean;
  muted: boolean;
  webContentsId: number | null;
  error: { code: number; description: string; url: string } | null;
  crashed: boolean;
};

type Prefs = { engine: string; home: string; bookmarksBar: boolean };
const DEFAULT_PREFS: Prefs = { engine: 'google', home: INTERNAL.newTab, bookmarksBar: true };

const read = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value ? { ...fallback, ...JSON.parse(value) } : fallback;
  } catch {
    return fallback;
  }
};
const readList = <T,>(key: string): T[] => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

let tabSerial = 0;
const makeTab = (url: string, incognito = false): Tab => ({
  id: `t${Date.now().toString(36)}${(tabSerial++).toString(36)}`,
  url,
  initial: url,
  webKey: 0,
  title: '',
  favicon: '',
  loading: !isInternal(url),
  canBack: false,
  canForward: false,
  incognito,
  audible: false,
  muted: false,
  webContentsId: null,
  error: null,
  crashed: false,
});

const nextZoom = (current: number, direction: 1 | -1) => {
  const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
  const at = index < 0 ? ZOOM_STEPS.length - 1 : index;
  if (direction > 0) return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS[at] > current + 0.001 ? at : at + 1)];
  return ZOOM_STEPS[Math.max(0, at - 1)];
};

const formatBytes = (bytes: number) => {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** exp).toFixed(exp ? 1 : 0)} ${units[exp]}`;
};

// O webview é criado à mão (e não pelo React): o React não pode mexer no src depois, senão recarregaria a página.
function WebviewHost({ tab, active, onReady }: { tab: Tab; active: boolean; onReady(element: WebviewElement | null): void }) {
  const host = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useLayoutEffect(() => {
    const element = document.createElement('webview') as WebviewElement;
    element.setAttribute('partition', tab.incognito ? INCOGNITO_PARTITION : NORMAL_PARTITION);
    element.setAttribute('allowpopups', 'true');
    element.setAttribute('plugins', 'true');
    element.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, spellcheck=yes');
    element.setAttribute('src', tab.initial);
    element.className = 'br-webview';
    host.current?.appendChild(element);
    onReadyRef.current(element);
    return () => {
      onReadyRef.current(null);
      element.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} className="br-page" data-active={active} aria-hidden={!active} />;
}

export default function Browser({ visible }: { visible: boolean }) {
  const t = useT();
  const [prefs, setPrefsState] = useState<Prefs>(() => read(PREFS_KEY, DEFAULT_PREFS));
  const [tabs, setTabsState] = useState<Tab[]>(() => {
    const saved = read<{ tabs: { url: string; title: string }[]; active: number }>(SESSION_KEY, { tabs: [], active: 0 });
    const list = saved.tabs.filter((item) => item && typeof item.url === 'string').map((item) => ({ ...makeTab(item.url), title: item.title ?? '' }));
    return list.length ? list : [makeTab(INTERNAL.newTab)];
  });
  const [activeId, setActiveId] = useState(() => {
    const saved = read<{ active: number }>(SESSION_KEY, { active: 0 });
    return tabs[Math.min(Math.max(0, saved.active | 0), tabs.length - 1)].id;
  });
  const [closed, setClosed] = useState<{ url: string; incognito: boolean; index: number }[]>([]);
  const [bookmarks, setBookmarksState] = useState<BrowserBookmark[]>([]);
  const [history, setHistory] = useState<BrowserVisit[]>([]);
  const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [permissions, setPermissions] = useState<BrowserPermissionRequest[]>([]);
  const [remember, setRemember] = useState(true);
  const [find, setFind] = useState<{ open: boolean; text: string; active: number; matches: number }>({ open: false, text: '', active: 0, matches: 0 });
  const [address, setAddress] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [hoverUrl, setHoverUrl] = useState('');
  const [zooms, setZooms] = useState<Record<string, number>>(() => read(ZOOM_KEY, {}));
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [siteInfo, setSiteInfo] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const webviews = useRef(new Map<string, WebviewElement>());
  const omnibox = useRef<HTMLInputElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const activeWebview = () => webviews.current.get(activeRef.current) ?? null;

  const setTabs = (update: (list: Tab[]) => Tab[]) => setTabsState((list) => update(list));
  const patchTab = (id: string, patch: Partial<Tab>) => setTabs((list) => list.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // armazenamento indisponível: vale só nesta sessão
      }
      return next;
    });
  const saveBookmarks = (next: BrowserBookmark[]) => {
    setBookmarksState(next);
    void window.api.browser.saveBookmarks(next);
  };
  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? null : current)), 3000);
  };

  // Sessão: guias normais (as anônimas nunca são gravadas) e qual está à vista.
  useEffect(() => {
    const normal = tabs.filter((tab) => !tab.incognito);
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ tabs: normal.map((tab) => ({ url: tab.url, title: tab.title })), active: Math.max(0, normal.findIndex((tab) => tab.id === activeId)) }));
    } catch {
      // armazenamento indisponível
    }
  }, [tabs, activeId]);

  useEffect(() => {
    void window.api.browser.bookmarks().then(setBookmarksState);
    void window.api.browser.history().then(setHistory);
    void window.api.browser.downloads().then(setDownloads);
  }, []);

  // ---------- Navegação ----------

  const navigate = (id: string, url: string) => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (!tab) return;
    setAddress(null);
    if (isInternal(url)) {
      patchTab(id, { url, title: '', favicon: '', loading: false, error: null, crashed: false });
      if (url === INTERNAL.history) void window.api.browser.history().then(setHistory);
      if (url === INTERNAL.downloads) void window.api.browser.downloads().then(setDownloads);
      return;
    }
    const webview = webviews.current.get(id);
    if (webview && !isInternal(tab.url) && !tab.crashed) {
      patchTab(id, { error: null });
      void webview.loadURL(url).catch(() => undefined);
    } else patchTab(id, { url, initial: url, webKey: tab.webKey + 1, loading: true, error: null, crashed: false, title: '', favicon: '' });
  };

  const openTab = (url: string, options: { background?: boolean; incognito?: boolean; after?: string } = {}) => {
    const tab = makeTab(url, options.incognito ?? false);
    setTabs((list) => {
      const anchor = list.findIndex((item) => item.id === (options.after ?? activeRef.current));
      const next = [...list];
      next.splice(anchor < 0 ? next.length : anchor + 1, 0, tab);
      return next;
    });
    if (!options.background) {
      setActiveId(tab.id);
      if (url === INTERNAL.newTab) requestAnimationFrame(() => omnibox.current?.focus());
    }
    return tab;
  };

  // Fecha uma ou várias guias de uma vez (o estado só muda no fim, para "fechar outras" não perder nenhuma).
  const closeTabs = (ids: string[]) => {
    const list = tabsRef.current;
    const gone = list.filter((tab) => ids.includes(tab.id));
    if (!gone.length) return;
    const reopenable = gone.filter((tab) => !tab.incognito && tab.url !== INTERNAL.newTab).map((tab) => ({ url: tab.url, incognito: false, index: list.indexOf(tab) }));
    if (reopenable.length) setClosed((stack) => [...reopenable.reverse(), ...stack].slice(0, MAX_CLOSED));
    const rest = list.filter((tab) => !ids.includes(tab.id));
    // Última guia anônima fechada: a sessão anônima é apagada.
    if (gone.some((tab) => tab.incognito) && !rest.some((tab) => tab.incognito)) void window.api.browser.endIncognito();
    tabsRef.current = rest;
    if (!rest.length) {
      const fresh = makeTab(INTERNAL.newTab);
      tabsRef.current = [fresh];
      setTabsState([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setTabsState(rest);
    if (ids.includes(activeRef.current)) {
      const index = list.findIndex((tab) => tab.id === activeRef.current);
      const after = list.slice(index + 1).find((tab) => !ids.includes(tab.id)) ?? [...list.slice(0, index)].reverse().find((tab) => !ids.includes(tab.id));
      setActiveId((after ?? rest[0]).id);
    }
  };
  const closeTab = (id: string) => closeTabs([id]);

  const reopenClosed = () => {
    const [last, ...stack] = closed;
    if (!last) return;
    setClosed(stack);
    const tab = makeTab(last.url, last.incognito);
    setTabs((list) => {
      const next = [...list];
      next.splice(Math.min(last.index, next.length), 0, tab);
      return next;
    });
    setActiveId(tab.id);
  };

  const cycle = (delta: number) => {
    const list = tabsRef.current;
    const index = list.findIndex((tab) => tab.id === activeRef.current);
    setActiveId(list[(index + delta + list.length) % list.length].id);
  };

  const goHome = () => navigate(activeRef.current, prefs.home || INTERNAL.newTab);

  const zoomFor = (url: string) => zooms[hostOf(url)] ?? 1;
  const setZoom = (factor: number) => {
    const tab = tabsRef.current.find((item) => item.id === activeRef.current);
    if (!tab || isInternal(tab.url)) return;
    const host = hostOf(tab.url);
    const next = { ...zooms };
    if (Math.abs(factor - 1) < 0.001) delete next[host];
    else next[host] = factor;
    setZooms(next);
    try {
      localStorage.setItem(ZOOM_KEY, JSON.stringify(next));
    } catch {
      // armazenamento indisponível
    }
    // Como no Chrome, o zoom vale para todas as guias do mesmo site.
    for (const item of tabsRef.current) if (hostOf(item.url) === host) webviews.current.get(item.id)?.setZoomFactor(factor);
  };

  const isBookmarked = (url: string) => bookmarks.some((bookmark) => bookmark.url === url);
  const toggleBookmark = () => {
    const tab = tabsRef.current.find((item) => item.id === activeRef.current);
    if (!tab || isInternal(tab.url)) return;
    if (isBookmarked(tab.url)) {
      saveBookmarks(bookmarks.filter((bookmark) => bookmark.url !== tab.url));
      flash(t('browser.bookmarkRemoved'));
    } else {
      saveBookmarks([...bookmarks, { id: `b${Date.now().toString(36)}`, url: tab.url, title: tab.title || displayUrl(tab.url) }]);
      flash(t('browser.bookmarkAdded'));
    }
  };

  const openFind = () => {
    setFind((current) => ({ ...current, open: true }));
    requestAnimationFrame(() => {
      findInput.current?.focus();
      findInput.current?.select();
    });
  };
  const findStep = (forward: boolean) => {
    const webview = activeWebview();
    if (!webview || !find.text) return;
    webview.findInPage(find.text, { forward, findNext: true });
  };
  const closeFind = () => {
    activeWebview()?.stopFindInPage('keepSelection');
    setFind((current) => ({ ...current, open: false, matches: 0, active: 0 }));
  };

  const toggleDevTools = () => {
    const webview = activeWebview();
    if (!webview) return;
    if (webview.isDevToolsOpened()) webview.closeDevTools();
    else webview.openDevTools();
  };

  const focusOmnibox = (value?: string) => {
    if (value !== undefined) setAddress(value);
    requestAnimationFrame(() => {
      omnibox.current?.focus();
      omnibox.current?.select();
    });
  };

  const savePdf = () => {
    const id = active.webContentsId;
    if (id !== null) void window.api.browser.savePdf(id).catch((error) => flash(String(error)));
  };

  // Um lugar só para os atalhos: teclado na moldura, teclado dentro da página (via main) e o menu do app.
  const runShortcut = (combo: string): boolean => {
    const webview = activeWebview();
    const index = Number(combo.match(/^Ctrl\+([1-9])$/)?.[1]);
    if (index) {
      const list = tabsRef.current;
      setActiveId((index === 9 ? list[list.length - 1] : list[Math.min(index, list.length) - 1]).id);
      return true;
    }
    switch (combo) {
      case 'Ctrl+T':
      case 'Ctrl+N':
        openTab(INTERNAL.newTab);
        return true;
      case 'Ctrl+Shift+N':
        openTab(INTERNAL.newTab, { incognito: true });
        return true;
      case 'Ctrl+Shift+T':
        reopenClosed();
        return true;
      case 'Ctrl+W':
      case 'Ctrl+F4':
        closeTab(activeRef.current);
        return true;
      case 'Ctrl+Shift+W':
        closeTabs(tabsRef.current.map((tab) => tab.id));
        return true;
      case 'Ctrl+Tab':
      case 'Ctrl+PageDown':
        cycle(1);
        return true;
      case 'Ctrl+Shift+Tab':
      case 'Ctrl+PageUp':
        cycle(-1);
        return true;
      case 'Ctrl+L':
      case 'Alt+D':
      case 'F6':
        focusOmnibox();
        return true;
      case 'Ctrl+K':
      case 'Ctrl+E':
        focusOmnibox('');
        return true;
      case 'Ctrl+F':
        openFind();
        return true;
      case 'F3':
      case 'Ctrl+G':
        if (!find.open) openFind();
        else findStep(true);
        return true;
      case 'Shift+F3':
      case 'Ctrl+Shift+G':
        findStep(false);
        return true;
      case 'Escape':
        if (find.open) closeFind();
        else if (active.loading) webview?.stop();
        return find.open;
      case 'Ctrl+R':
      case 'F5':
        if (active.crashed) navigate(active.id, active.url);
        else webview?.reload();
        return true;
      case 'Ctrl+F5':
      case 'Shift+F5':
      case 'Ctrl+Shift+R':
        webview?.reloadIgnoringCache();
        return true;
      case 'Alt+ArrowLeft':
      case 'BrowserBack':
        if (webview?.canGoBack()) webview.goBack();
        return true;
      case 'Alt+ArrowRight':
      case 'BrowserForward':
        if (webview?.canGoForward()) webview.goForward();
        return true;
      case 'Alt+Home':
        goHome();
        return true;
      case 'Ctrl+D':
        toggleBookmark();
        return true;
      case 'Ctrl+Shift+B':
        setPrefs({ bookmarksBar: !prefs.bookmarksBar });
        return true;
      case 'Ctrl+Shift+O':
        openTab(INTERNAL.bookmarks);
        return true;
      case 'Ctrl+H':
        openTab(INTERNAL.history);
        return true;
      case 'Ctrl+J':
        openTab(INTERNAL.downloads);
        return true;
      case 'Ctrl+Shift+Delete':
        openTab(INTERNAL.settings);
        return true;
      case 'Ctrl+P':
        void webview?.print().catch(() => undefined);
        return true;
      case 'Ctrl+S':
        if (active.webContentsId !== null) void window.api.browser.savePage(active.webContentsId);
        return true;
      case 'Ctrl+U':
        if (!isInternal(active.url)) openTab(`view-source:${active.url}`);
        return true;
      case 'Ctrl+O':
        void window.api.browser.openFile().then((url) => url && navigate(activeRef.current, url));
        return true;
      case 'F12':
      case 'Ctrl+Shift+I':
      case 'Ctrl+Shift+J':
      case 'Ctrl+Shift+C':
        toggleDevTools();
        return true;
      case 'Ctrl+=':
      case 'Ctrl+Shift+=':
        setZoom(nextZoom(zoomFor(active.url), 1));
        return true;
      case 'Ctrl+-':
        setZoom(nextZoom(zoomFor(active.url), -1));
        return true;
      case 'Ctrl+0':
        setZoom(1);
        return true;
      default:
        return false;
    }
  };
  const runShortcutRef = useRef(runShortcut);
  runShortcutRef.current = runShortcut;

  // Menu do app (acelerador nativo) com a guia Navegador à vista: as teclas têm o sentido do Chrome.
  useEffect(() => {
    if (!visible) return;
    const map: Partial<Record<MenuAction, string>> = {
      'new-tab': 'Ctrl+T',
      'new-note': 'Ctrl+N',
      'close-tab': 'Ctrl+W',
      'reopen-tab': 'Ctrl+Shift+T',
      'next-tab': 'Ctrl+Tab',
      'prev-tab': 'Ctrl+Shift+Tab',
      reload: 'Ctrl+R',
      'force-reload': 'Ctrl+Shift+R',
      devtools: 'F12',
      'zoom-in': 'Ctrl+=',
      'zoom-out': 'Ctrl+-',
      'zoom-reset': 'Ctrl+0',
      back: 'Alt+ArrowLeft',
      forward: 'Alt+ArrowRight',
      'copy-link': 'Ctrl+L',
      'daily-note': 'Ctrl+D',
      whiteboards: 'Ctrl+Shift+B',
      graph: 'Ctrl+G',
      'quick-switcher': 'Ctrl+P',
      'choose-vault': 'Ctrl+O',
      tasks: 'Ctrl+Shift+J',
    };
    return setBrowserMenuHandler((action) => {
      const combo = map[action];
      return combo ? runShortcutRef.current(combo) : false;
    });
  }, [visible]);

  // Teclado na moldura (barra de endereço, páginas internas): os atalhos do Chrome antes do menu do app.
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      const combo = comboOf(event);
      if (!BROWSER_SHORTCUTS.has(combo)) return;
      if (runShortcutRef.current(combo)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visible]);

  // Eventos do processo principal: atalhos dentro da página, links para nova guia, downloads e permissões.
  useEffect(() => {
    const tabOf = (webContentsId: number) => tabsRef.current.find((tab) => tab.webContentsId === webContentsId);
    const offs = [
      window.api.browser.onShortcut(({ webContentsId, combo }) => {
        if (tabOf(webContentsId)) runShortcutRef.current(combo);
      }),
      window.api.browser.onOpen(({ url, background, incognito, from }) => {
        const source = tabOf(from);
        openTab(url, { background, incognito: incognito || source?.incognito, after: source?.id });
      }),
      window.api.browser.onSearch(({ text, incognito, from }) => {
        const source = tabOf(from);
        openTab(searchUrl(text, prefsRef.current.engine), { incognito: incognito || source?.incognito, after: source?.id });
      }),
      window.api.browser.onDownload((download) => {
        setDownloads((list) => {
          const known = list.some((item) => item.id === download.id);
          if (!known) setDownloadsOpen(true);
          return known ? list.map((item) => (item.id === download.id ? download : item)) : [download, ...list];
        });
      }),
      window.api.browser.onPermission((request) => setPermissions((list) => [...list, request])),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // Liga os eventos de um webview recém-criado ao estado da guia.
  const bindWebview = (tabId: string, element: WebviewElement | null) => {
    if (!element) {
      webviews.current.delete(tabId);
      return;
    }
    webviews.current.set(tabId, element);
    const tab = () => tabsRef.current.find((item) => item.id === tabId);
    const navState = () => ({ canBack: element.canGoBack(), canForward: element.canGoForward() });
    const on = (name: string, handler: (event: Event & Record<string, unknown>) => void) => element.addEventListener(name, handler as EventListener);
    on('dom-ready', () => {
      const id = element.getWebContentsId();
      patchTab(tabId, { webContentsId: id, ...navState() });
      const current = tab();
      if (current) element.setZoomFactor(zoomsRef.current[hostOf(element.getURL())] ?? 1);
      if (current?.muted) element.setAudioMuted(true);
    });
    on('did-start-loading', () => patchTab(tabId, { loading: true, error: null }));
    on('did-stop-loading', () => patchTab(tabId, { loading: false, ...navState() }));
    on('did-navigate', (event) => {
      const url = String(event.url);
      patchTab(tabId, { url, ...navState(), favicon: '' });
      element.setZoomFactor(zoomsRef.current[hostOf(url)] ?? 1);
      if (!tab()?.incognito) recordVisit(url, element.getTitle());
    });
    on('did-navigate-in-page', (event) => {
      if (!event.isMainFrame) return;
      const url = String(event.url);
      patchTab(tabId, { url, ...navState() });
      if (!tab()?.incognito) recordVisit(url, element.getTitle());
    });
    on('page-title-updated', (event) => {
      const title = String(event.title);
      patchTab(tabId, { title });
      if (!tab()?.incognito) recordVisit(element.getURL(), title);
    });
    on('page-favicon-updated', (event) => {
      const [icon] = event.favicons as string[];
      if (icon) patchTab(tabId, { favicon: icon });
    });
    on('did-fail-load', (event) => {
      // -3 é "abortado" (outra navegação começou): não é erro para o usuário.
      if (!event.isMainFrame || event.errorCode === -3) return;
      patchTab(tabId, { loading: false, error: { code: Number(event.errorCode), description: String(event.errorDescription), url: String(event.validatedURL) } });
    });
    on('render-process-gone', () => patchTab(tabId, { crashed: true, loading: false }));
    on('media-started-playing', () => patchTab(tabId, { audible: true }));
    on('media-paused', () => patchTab(tabId, { audible: false }));
    on('update-target-url', (event) => {
      if (tabId === activeRef.current) setHoverUrl(String(event.url));
    });
    on('found-in-page', (event) => {
      const result = event.result as { activeMatchOrdinal: number; matches: number };
      if (tabId === activeRef.current) setFind((current) => ({ ...current, active: result.activeMatchOrdinal, matches: result.matches }));
    });
  };
  const zoomsRef = useRef(zooms);
  zoomsRef.current = zooms;

  const recordVisit = (url: string, title: string) => {
    if (!/^(https?|file):/i.test(url)) return;
    const visit = { url, title, time: Date.now() };
    void window.api.browser.addVisit(visit);
    // A lista local (sugestões) recebe a visita sem ir ao disco a cada página.
    setHistory((list) => (list[0]?.url === url ? [{ ...list[0], title: title || list[0].title }, ...list.slice(1)] : [visit, ...list]));
  };

  // Ao trocar de guia: busca na página fecha, endereço volta, link sob o mouse some.
  useEffect(() => {
    setAddress(null);
    setHoverUrl('');
    setSiteInfo(false);
    setFind((current) => (current.open ? { ...current, open: false, matches: 0, active: 0 } : current));
    if (visible && !isInternal(active.url)) requestAnimationFrame(() => activeWebview()?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Busca na página enquanto digita.
  useEffect(() => {
    const webview = activeWebview();
    if (!find.open || !webview) return;
    if (find.text) webview.findInPage(find.text);
    else {
      webview.stopFindInPage('clearSelection');
      setFind((current) => ({ ...current, matches: 0, active: 0 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find.text, find.open]);

  // ---------- Barra de endereço ----------

  const suggestions: Suggestion[] = useMemo(() => (address ? suggest(address, prefs.engine, bookmarks, history) : []), [address, prefs.engine, bookmarks, history]);
  const submitAddress = (url?: string) => {
    const target = url ?? suggestions[selected]?.url ?? resolveInput(address ?? '', prefs.engine);
    navigate(activeRef.current, target);
    omnibox.current?.blur();
    requestAnimationFrame(() => activeWebview()?.focus());
  };

  const security = (() => {
    const url = active.url;
    if (isInternal(url)) return { kind: 'internal' as const, label: t('browser.secure.internal') };
    if (url.startsWith('https:')) return { kind: 'secure' as const, label: t('browser.secure.https') };
    if (url.startsWith('file:')) return { kind: 'file' as const, label: t('browser.secure.file') };
    if (url.startsWith('http:')) return { kind: 'insecure' as const, label: t('browser.secure.http') };
    return { kind: 'internal' as const, label: url.split(':')[0] };
  })();

  // ---------- Menus ----------

  const mainMenu = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const zoom = zoomFor(active.url);
    const web = !isInternal(active.url);
    const items: MenuItem[] = [
      { label: t('browser.menu.newTab'), keys: 'Ctrl T', run: () => openTab(INTERNAL.newTab) },
      { label: t('browser.menu.newIncognito'), keys: 'Ctrl Shift N', run: () => openTab(INTERNAL.newTab, { incognito: true }) },
      { label: t('browser.menu.reopen'), keys: 'Ctrl Shift T', disabled: !closed.length, run: reopenClosed },
      { kind: 'separator' },
      { label: t('browser.menu.history'), keys: 'Ctrl H', run: () => openTab(INTERNAL.history) },
      { label: t('browser.menu.downloads'), keys: 'Ctrl J', run: () => openTab(INTERNAL.downloads) },
      { label: t('browser.menu.bookmarks'), keys: 'Ctrl Shift O', run: () => openTab(INTERNAL.bookmarks) },
      { label: t(prefs.bookmarksBar ? 'browser.menu.hideBar' : 'browser.menu.showBar'), keys: 'Ctrl Shift B', run: () => setPrefs({ bookmarksBar: !prefs.bookmarksBar }) },
      { kind: 'separator' },
      { label: t('browser.menu.zoomIn', { zoom: Math.round(zoom * 100) }), keys: 'Ctrl +', disabled: !web, run: () => setZoom(nextZoom(zoom, 1)) },
      { label: t('browser.menu.zoomOut'), keys: 'Ctrl -', disabled: !web, run: () => setZoom(nextZoom(zoom, -1)) },
      { label: t('browser.menu.zoomReset'), keys: 'Ctrl 0', disabled: !web || zoom === 1, run: () => setZoom(1) },
      { kind: 'separator' },
      { label: t('browser.menu.find'), keys: 'Ctrl F', disabled: !web, run: openFind },
      { label: t('browser.menu.print'), keys: 'Ctrl P', disabled: !web, run: () => void activeWebview()?.print().catch(() => undefined) },
      { label: t('browser.menu.savePdf'), disabled: !web, run: savePdf },
      { label: t('browser.menu.savePage'), keys: 'Ctrl S', disabled: !web, run: () => active.webContentsId !== null && void window.api.browser.savePage(active.webContentsId) },
      { label: t('browser.menu.openFile'), keys: 'Ctrl O', run: () => void window.api.browser.openFile().then((url) => url && navigate(activeRef.current, url)) },
      { kind: 'separator' },
      { label: t('browser.menu.viewSource'), keys: 'Ctrl U', disabled: !web, run: () => openTab(`view-source:${active.url}`) },
      { label: t('browser.menu.devtools'), keys: 'F12', disabled: !web, run: toggleDevTools },
      { label: t('browser.menu.openExternal'), disabled: !/^https?:/.test(active.url), run: () => window.open(active.url, '_blank') },
      { kind: 'separator' },
      { label: t('browser.menu.clearData'), keys: 'Ctrl Shift Del', run: () => openTab(INTERNAL.settings) },
      { label: t('browser.menu.settings'), run: () => openTab(INTERNAL.settings) },
    ];
    setMenu({ x: rect.right - 280, y: rect.bottom + 4, items, label: t('browser.menu.label') });
  };

  const tabMenu = (tab: Tab, x: number, y: number) => {
    const index = tabs.findIndex((item) => item.id === tab.id);
    setMenu({
      x,
      y,
      label: tab.title || t('browser.newTab'),
      items: [
        { label: t('browser.tab.newRight'), run: () => openTab(INTERNAL.newTab, { after: tab.id }) },
        { kind: 'separator' },
        { label: t('browser.tab.reload'), disabled: isInternal(tab.url), run: () => webviews.current.get(tab.id)?.reload() },
        { label: t('browser.tab.duplicate'), run: () => openTab(tab.url, { after: tab.id, incognito: tab.incognito }) },
        {
          label: t(tab.muted ? 'browser.tab.unmute' : 'browser.tab.mute'),
          disabled: isInternal(tab.url),
          run: () => {
            webviews.current.get(tab.id)?.setAudioMuted(!tab.muted);
            patchTab(tab.id, { muted: !tab.muted });
          },
        },
        { label: t('browser.tab.bookmark'), disabled: isInternal(tab.url) || isBookmarked(tab.url), run: () => saveBookmarks([...bookmarks, { id: `b${Date.now().toString(36)}`, url: tab.url, title: tab.title || displayUrl(tab.url) }]) },
        { kind: 'separator' },
        { label: t('browser.tab.close'), keys: 'Ctrl W', run: () => closeTab(tab.id) },
        { label: t('browser.tab.closeOthers'), disabled: tabs.length < 2, run: () => closeTabs(tabs.filter((item) => item.id !== tab.id).map((item) => item.id)) },
        { label: t('browser.tab.closeRight'), disabled: index === tabs.length - 1, run: () => closeTabs(tabs.slice(index + 1).map((item) => item.id)) },
        { kind: 'separator' },
        { label: t('browser.menu.reopen'), keys: 'Ctrl Shift T', disabled: !closed.length, run: reopenClosed },
      ],
    });
  };

  const bookmarkMenu = (bookmark: BrowserBookmark, x: number, y: number) =>
    setMenu({
      x,
      y,
      label: bookmark.title,
      items: [
        { label: t('browser.ctx.open'), run: () => navigate(activeRef.current, bookmark.url) },
        { label: t('browser.ctx.openTab'), run: () => openTab(bookmark.url, { background: true }) },
        { label: t('browser.ctx.openIncognito'), run: () => openTab(bookmark.url, { incognito: true }) },
        { kind: 'separator' },
        { label: t('browser.ctx.copyUrl'), run: () => void navigator.clipboard.writeText(bookmark.url) },
        { label: t('browser.ctx.remove'), danger: true, run: () => saveBookmarks(bookmarks.filter((item) => item.id !== bookmark.id)) },
      ],
    });

  // ---------- Arrastar guias ----------

  const dragging = useRef<string | null>(null);
  const dropOn = (targetId: string) => {
    const from = dragging.current;
    dragging.current = null;
    if (!from || from === targetId) return;
    setTabs((list) => {
      const moving = list.find((tab) => tab.id === from);
      if (!moving) return list;
      const rest = list.filter((tab) => tab.id !== from);
      const at = rest.findIndex((tab) => tab.id === targetId);
      rest.splice(at < 0 ? rest.length : at + (list.findIndex((tab) => tab.id === from) < list.findIndex((tab) => tab.id === targetId) ? 1 : 0), 0, moving);
      return rest;
    });
  };

  // ---------- Permissões ----------

  const permission = permissions.find((request) => tabs.find((tab) => tab.webContentsId === request.webContentsId)?.id === activeId) ?? (permissions[0] && !tabs.some((tab) => tab.webContentsId === permissions[0].webContentsId) ? permissions[0] : null);
  const answerPermission = (request: BrowserPermissionRequest, allow: boolean) => {
    void window.api.browser.replyPermission(request.id, allow, remember, request.origin, request.permission);
    setPermissions((list) => list.filter((item) => item.id !== request.id));
  };
  const permissionLabel = (name: string) => {
    if (name.startsWith('media:')) return name.slice(6).split('+').map((kind) => t(kind === 'video' ? 'browser.perm.camera' : 'browser.perm.microphone')).join(' + ');
    const key = `browser.perm.${name}` as Key;
    const label = t(key);
    return label === key ? name : label;
  };

  const activeDownloads = downloads.filter((item) => item.state === 'progressing' || item.state === 'paused');
  const sessionDownloads = downloads.slice(0, 6);
  const zoom = zoomFor(active.url);

  return (
    <div className={`browser ${active.incognito ? 'is-incognito' : ''}`} data-hidden={!visible || undefined} aria-hidden={!visible} data-testid="browser">
      {/* Guias */}
      <div className="br-tabstrip" role="tablist" aria-label={t('browser.tabs')}>
        {tabs.map((tab) => {
          const title = tab.title || (isInternal(tab.url) ? t(internalTitle(tab.url)) : displayUrl(tab.url)) || t('browser.newTab');
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={tab.id === activeId}
              className="br-tab"
              data-active={tab.id === activeId}
              data-incognito={tab.incognito || undefined}
              title={title}
              draggable
              onDragStart={() => (dragging.current = tab.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropOn(tab.id)}
              onClick={() => setActiveId(tab.id)}
              onAuxClick={(event) => event.button === 1 && closeTab(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                tabMenu(tab, event.clientX, event.clientY);
              }}
              onKeyDown={(event) => event.key === 'Enter' && setActiveId(tab.id)}
            >
              <span className="br-tab-icon">
                {tab.loading ? <span className="br-spinner" aria-hidden /> : tab.favicon ? <img src={tab.favicon} alt="" width={16} height={16} /> : tab.incognito ? <IncognitoIcon /> : <GlobeIcon />}
              </span>
              <span className="br-tab-title">{title}</span>
              {(tab.audible || tab.muted) && (
                <button
                  type="button"
                  className="br-tab-audio"
                  title={t(tab.muted ? 'browser.tab.unmute' : 'browser.tab.mute')}
                  aria-label={t(tab.muted ? 'browser.tab.unmute' : 'browser.tab.mute')}
                  onClick={(event) => {
                    event.stopPropagation();
                    webviews.current.get(tab.id)?.setAudioMuted(!tab.muted);
                    patchTab(tab.id, { muted: !tab.muted });
                  }}
                >
                  <SpeakerIcon muted={tab.muted} />
                </button>
              )}
              <button
                type="button"
                className="br-tab-close"
                title={t('browser.tab.close')}
                aria-label={`${t('browser.tab.close')}: ${title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="m2 2 6 6M8 2 2 8" /></svg>
              </button>
            </div>
          );
        })}
        <button type="button" className="br-newtab" title={`${t('browser.menu.newTab')} (Ctrl+T)`} aria-label={t('browser.menu.newTab')} onClick={() => openTab(INTERNAL.newTab)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 1.5v9M1.5 6h9" /></svg>
        </button>
      </div>

      {/* Barra de ferramentas */}
      <div className="br-toolbar">
        <ToolButton label={`${t('browser.back')} (Alt+←)`} disabled={!active.canBack} onClick={() => activeWebview()?.goBack()}>
          <path d="M10 3 5 8l5 5" />
        </ToolButton>
        <ToolButton label={`${t('browser.forward')} (Alt+→)`} disabled={!active.canForward} onClick={() => activeWebview()?.goForward()}>
          <path d="m6 3 5 5-5 5" />
        </ToolButton>
        {active.loading ? (
          <ToolButton label={`${t('browser.stop')} (Esc)`} onClick={() => activeWebview()?.stop()}>
            <path d="m4 4 8 8M12 4l-8 8" />
          </ToolButton>
        ) : (
          <ToolButton label={`${t('browser.reload')} (Ctrl+R)`} disabled={isInternal(active.url) && !active.crashed} onClick={() => runShortcut('Ctrl+R')}>
            <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5" />
          </ToolButton>
        )}
        <ToolButton label={`${t('browser.home')} (Alt+Home)`} onClick={goHome}>
          <path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3V9.5h2V13h3V6.5" />
        </ToolButton>

        <div className="br-omnibox" data-focused={address !== null}>
          <button type="button" className="br-security" data-kind={security.kind} title={security.label} aria-label={security.label} onClick={() => setSiteInfo((open) => !open)}>
            {security.kind === 'secure' ? <LockIcon /> : security.kind === 'insecure' ? <WarnIcon /> : security.kind === 'file' ? <FileIcon /> : <InfoIcon />}
            {security.kind === 'insecure' && <span className="br-security-text">{t('browser.secure.notSecure')}</span>}
          </button>
          <input
            ref={omnibox}
            className="br-address"
            value={address ?? displayUrl(active.url)}
            placeholder={t('browser.addressPlaceholder', { engine: engineById(prefs.engine).label })}
            aria-label={t('browser.address')}
            spellCheck={false}
            autoComplete="off"
            onFocus={(event) => {
              setAddress(isInternal(active.url) ? '' : active.url);
              setSelected(0);
              const input = event.currentTarget;
              requestAnimationFrame(() => input.select());
            }}
            onBlur={() => window.setTimeout(() => setAddress(null), 120)}
            onChange={(event) => {
              setAddress(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                // Alt+Enter abre em nova guia, como no Chrome.
                const target = suggestions[selected]?.url ?? resolveInput(address ?? '', prefs.engine);
                if (event.altKey) {
                  openTab(target);
                  setAddress(null);
                } else submitAddress(target);
              } else if (event.key === 'ArrowDown' && suggestions.length) {
                event.preventDefault();
                setSelected((index) => (index + 1) % suggestions.length);
              } else if (event.key === 'ArrowUp' && suggestions.length) {
                event.preventDefault();
                setSelected((index) => (index - 1 + suggestions.length) % suggestions.length);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setAddress(null);
                event.currentTarget.blur();
                activeWebview()?.focus();
              }
            }}
          />
          {zoom !== 1 && (
            <button type="button" className="br-pill" title={t('browser.zoomReset')} onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
          )}
          {!isInternal(active.url) && (
            <button type="button" className="br-star" data-on={isBookmarked(active.url)} title={`${t(isBookmarked(active.url) ? 'browser.unbookmark' : 'browser.bookmark')} (Ctrl+D)`} aria-pressed={isBookmarked(active.url)} aria-label={t('browser.bookmark')} onClick={toggleBookmark}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill={isBookmarked(active.url) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="m8 2.4 1.7 3.5 3.85.55-2.8 2.7.67 3.8L8 11.15l-3.42 1.8.67-3.8-2.8-2.7 3.85-.55z" /></svg>
            </button>
          )}
          {address !== null && suggestions.length > 0 && (
            <ul className="br-suggestions" role="listbox" aria-label={t('browser.suggestions')}>
              {suggestions.map((item, index) => (
                <li
                  key={`${item.kind}:${item.url}`}
                  role="option"
                  aria-selected={index === selected}
                  className="br-suggestion"
                  data-selected={index === selected}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    submitAddress(item.url);
                  }}
                  onMouseEnter={() => setSelected(index)}
                >
                  <span className="br-suggestion-icon">{item.kind === 'search' ? <SearchIcon /> : item.kind === 'bookmark' ? <StarSmall /> : item.kind === 'history' ? <ClockIcon /> : <GlobeIcon />}</span>
                  <span className="br-suggestion-title">{item.kind === 'search' ? t('browser.searchFor', { text: item.title, engine: engineById(prefs.engine).label }) : item.title}</span>
                  {item.kind !== 'search' && item.title !== item.url && <span className="br-suggestion-url">{displayUrl(item.url)}</span>}
                </li>
              ))}
            </ul>
          )}
          {siteInfo && (
            <SiteInfo
              url={active.url}
              security={security.label}
              onClose={() => setSiteInfo(false)}
              onClearPermissions={(origin) => {
                void window.api.browser.resetPermissions(origin);
                flash(t('browser.permissionsReset'));
                setSiteInfo(false);
              }}
            />
          )}
        </div>

        {downloads.length > 0 && (
          <div className="relative">
            <ToolButton label={`${t('browser.menu.downloads')} (Ctrl+J)`} onClick={() => setDownloadsOpen((open) => !open)} badge={activeDownloads.length || undefined}>
              <path d="M8 2.5v7.75M4.75 7 8 10.25 11.25 7M2.75 13.25h10.5" />
            </ToolButton>
            {downloadsOpen && (
              <div className="br-popover br-downloads-pop" role="dialog" aria-label={t('browser.menu.downloads')}>
                <div className="br-popover-head">
                  {t('browser.recentDownloads')}
                  <button type="button" className="br-link" onClick={() => setDownloadsOpen(false)}>
                    {t('browser.close')}
                  </button>
                </div>
                {sessionDownloads.map((item) => (
                  <DownloadRow key={item.id} item={item} compact />
                ))}
                <button
                  type="button"
                  className="br-link br-popover-foot"
                  onClick={() => {
                    setDownloadsOpen(false);
                    openTab(INTERNAL.downloads);
                  }}
                >
                  {t('browser.allDownloads')}
                </button>
              </div>
            )}
          </div>
        )}
        {active.incognito && (
          <span className="br-incognito-badge" title={t('browser.incognitoHint')}>
            <IncognitoIcon /> {t('browser.incognito')}
          </span>
        )}
        <ToolButton label={t('browser.menu.label')} onClick={(event) => mainMenu(event.currentTarget)}>
          <path d="M8 3.5h.01M8 8h.01M8 12.5h.01" strokeWidth="2.4" />
        </ToolButton>
      </div>

      {/* Barra de favoritos */}
      {prefs.bookmarksBar && (
        <div className="br-bookmarks" role="toolbar" aria-label={t('browser.bookmarksBar')}>
          {bookmarks.length ? (
            bookmarks.map((bookmark) => (
              <button
                key={bookmark.id}
                type="button"
                className="br-bookmark"
                title={`${bookmark.title}\n${bookmark.url}`}
                onClick={(event) => (event.ctrlKey ? openTab(bookmark.url, { background: true }) : navigate(activeRef.current, bookmark.url))}
                onAuxClick={(event) => event.button === 1 && openTab(bookmark.url, { background: true })}
                onContextMenu={(event) => {
                  event.preventDefault();
                  bookmarkMenu(bookmark, event.clientX, event.clientY);
                }}
              >
                <img src={faviconFor(bookmark.url)} alt="" width={14} height={14} onError={(event) => (event.currentTarget.style.visibility = 'hidden')} />
                <span>{bookmark.title || displayUrl(bookmark.url)}</span>
              </button>
            ))
          ) : (
            <span className="br-bookmarks-empty">{t('browser.bookmarksEmpty')}</span>
          )}
        </div>
      )}

      {/* Pedido de permissão do site */}
      {permission && (
        <div className="br-permission" role="alertdialog" aria-label={t('browser.permissionTitle')}>
          <span className="min-w-0 flex-1">
            <strong>{hostOf(permission.origin) || permission.origin || t('browser.thisSite')}</strong> {t('browser.wants', { what: permissionLabel(permission.permission) })}
          </span>
          <label className="br-check">
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> {t('browser.remember')}
          </label>
          <button type="button" className="br-btn" onClick={() => answerPermission(permission, false)}>
            {t('browser.block')}
          </button>
          <button type="button" className="br-btn br-btn-primary" onClick={() => answerPermission(permission, true)}>
            {t('browser.allow')}
          </button>
        </div>
      )}

      {/* Conteúdo */}
      <div className="br-content">
        {tabs.map((tab) =>
          isInternal(tab.url) ? null : <WebviewHost key={`${tab.id}:${tab.webKey}`} tab={tab} active={tab.id === activeId} onReady={(element) => bindWebview(tab.id, element)} />,
        )}
        {isInternal(active.url) && (
          <div className="br-internal">
            <InternalPage
              url={active.url}
              prefs={prefs}
              setPrefs={setPrefs}
              bookmarks={bookmarks}
              saveBookmarks={saveBookmarks}
              history={history}
              setHistory={setHistory}
              downloads={downloads}
              setDownloads={setDownloads}
              incognito={active.incognito}
              onNavigate={(url) => navigate(activeRef.current, url)}
              onOpenTab={(url) => openTab(url, { background: true })}
              onFlash={flash}
            />
          </div>
        )}
        {active.error && !isInternal(active.url) && (
          <div className="br-error">
            <div className="br-error-card">
              <WarnIcon size={40} />
              <h2>{t('browser.error.title')}</h2>
              <p>
                <strong>{hostOf(active.error.url) || active.error.url}</strong> — {active.error.description} <code>({active.error.code})</code>
              </p>
              <p className="opacity-70">{t('browser.error.hint')}</p>
              <button type="button" className="br-btn br-btn-primary" onClick={() => navigate(active.id, active.error!.url)}>
                {t('browser.reload')}
              </button>
            </div>
          </div>
        )}
        {active.crashed && (
          <div className="br-error">
            <div className="br-error-card">
              <h2>{t('browser.crash.title')}</h2>
              <p className="opacity-70">{t('browser.crash.hint')}</p>
              <button type="button" className="br-btn br-btn-primary" onClick={() => navigate(active.id, active.url)}>
                {t('browser.reload')}
              </button>
            </div>
          </div>
        )}

        {/* Buscar na página */}
        {find.open && (
          <div className="br-find" role="search">
            <input
              ref={findInput}
              value={find.text}
              placeholder={t('browser.findPlaceholder')}
              aria-label={t('browser.findPlaceholder')}
              onChange={(event) => setFind((current) => ({ ...current, text: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  findStep(!event.shiftKey);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closeFind();
                }
              }}
            />
            <span className="br-find-count">{find.text ? `${find.active}/${find.matches}` : ''}</span>
            <ToolButton label={`${t('browser.findPrev')} (Shift+Enter)`} small disabled={!find.matches} onClick={() => findStep(false)}>
              <path d="m4 10 4-4 4 4" />
            </ToolButton>
            <ToolButton label={`${t('browser.findNext')} (Enter)`} small disabled={!find.matches} onClick={() => findStep(true)}>
              <path d="m4 6 4 4 4-4" />
            </ToolButton>
            <ToolButton label={`${t('browser.close')} (Esc)`} small onClick={closeFind}>
              <path d="m4 4 8 8M12 4l-8 8" />
            </ToolButton>
          </div>
        )}

        {hoverUrl && <div className="br-status">{hoverUrl}</div>}
        {notice && (
          <div className="br-toast" role="status">
            {notice}
          </div>
        )}
      </div>

      {menu && <ContextMenu request={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

const internalTitle = (url: string): Key =>
  url === INTERNAL.history ? 'browser.page.history' : url === INTERNAL.downloads ? 'browser.page.downloads' : url === INTERNAL.bookmarks ? 'browser.page.bookmarks' : url === INTERNAL.settings ? 'browser.page.settings' : 'browser.newTab';

// Ícone do site sem carregar a página: o serviço de favicons do Google, como na nova guia do Chrome.
const faviconFor = (url: string) => {
  const host = hostOf(url);
  return host ? `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(host)}` : '';
};

function ToolButton({ label, disabled, small, badge, onClick, children }: { label: string; disabled?: boolean; small?: boolean; badge?: number; onClick(event: React.MouseEvent<HTMLButtonElement>): void; children: ReactNode }) {
  return (
    <button type="button" className={`br-tool ${small ? 'br-tool-small' : ''}`} title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      <svg width={small ? 14 : 16} height={small ? 14 : 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
      {badge !== undefined && <span className="br-badge">{badge}</span>}
    </button>
  );
}

function SiteInfo({ url, security, onClose, onClearPermissions }: { url: string; security: string; onClose(): void; onClearPermissions(origin: string): void }) {
  const t = useT();
  const origin = originOf(url);
  const [saved, setSaved] = useState<Record<string, 'allow' | 'deny'>>({});
  useEffect(() => {
    if (origin) void window.api.browser.permissions().then((all) => setSaved(all[origin] ?? {}));
  }, [origin]);
  return (
    <div className="br-popover br-siteinfo" role="dialog" aria-label={t('browser.siteInfo')}>
      <div className="br-popover-head">
        {hostOf(url) || url}
        <button type="button" className="br-link" onClick={onClose}>
          {t('browser.close')}
        </button>
      </div>
      <p className="br-muted">{security}</p>
      {Object.keys(saved).length > 0 && (
        <>
          <p className="br-section-label">{t('browser.sitePermissions')}</p>
          {Object.entries(saved).map(([name, value]) => (
            <div key={name} className="br-row">
              <span>{t(`browser.perm.${name}` as Key)}</span>
              <span className="br-muted">{t(value === 'allow' ? 'browser.allowed' : 'browser.blocked')}</span>
            </div>
          ))}
          <button type="button" className="br-btn" onClick={() => onClearPermissions(origin)}>
            {t('browser.resetPermissions')}
          </button>
        </>
      )}
    </div>
  );
}

function DownloadRow({ item, compact }: { item: BrowserDownload; compact?: boolean }) {
  const t = useT();
  const percent = item.total > 0 ? Math.round((item.received / item.total) * 100) : null;
  const running = item.state === 'progressing' || item.state === 'paused';
  const act = (action: Parameters<typeof window.api.browser.downloadAction>[1]) => void window.api.browser.downloadAction(item.id, action);
  return (
    <div className="br-download" data-state={item.state} data-compact={compact || undefined}>
      <div className="min-w-0 flex-1">
        <button type="button" className="br-download-name" disabled={item.state !== 'completed'} onClick={() => act('open')} title={item.path}>
          {item.filename}
        </button>
        <div className="br-muted br-download-meta">
          {running
            ? `${formatBytes(item.received)}${item.total ? ` / ${formatBytes(item.total)}` : ''}${item.state === 'paused' ? ` · ${t('browser.dl.paused')}` : ''}`
            : item.state === 'completed'
              ? formatBytes(item.total || item.received)
              : t(item.state === 'cancelled' ? 'browser.dl.cancelled' : 'browser.dl.failed')}
          {!compact && <span className="br-download-url"> · {item.url}</span>}
        </div>
        {running && (
          <div className="br-progress" aria-label={percent === null ? undefined : `${percent}%`}>
            <span style={{ width: `${percent ?? 30}%` }} data-indeterminate={percent === null || undefined} />
          </div>
        )}
      </div>
      <div className="br-download-actions">
        {item.state === 'progressing' && (
          <button type="button" className="br-link" onClick={() => act('pause')}>
            {t('browser.dl.pause')}
          </button>
        )}
        {item.state === 'paused' && (
          <button type="button" className="br-link" onClick={() => act('resume')}>
            {t('browser.dl.resume')}
          </button>
        )}
        {running && (
          <button type="button" className="br-link" onClick={() => act('cancel')}>
            {t('browser.dl.cancel')}
          </button>
        )}
        {item.state === 'completed' && (
          <button type="button" className="br-link" onClick={() => act('show')}>
            {t('browser.dl.show')}
          </button>
        )}
        {(item.state === 'cancelled' || item.state === 'interrupted') && (
          <button type="button" className="br-link" onClick={() => act('retry')}>
            {t('browser.dl.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

type InternalProps = {
  url: string;
  prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
  bookmarks: BrowserBookmark[];
  saveBookmarks(list: BrowserBookmark[]): void;
  history: BrowserVisit[];
  setHistory(list: BrowserVisit[]): void;
  downloads: BrowserDownload[];
  setDownloads(list: BrowserDownload[]): void;
  incognito: boolean;
  onNavigate(url: string): void;
  onOpenTab(url: string): void;
  onFlash(text: string): void;
};

function InternalPage(props: InternalProps) {
  if (props.url === INTERNAL.history) return <HistoryPage {...props} />;
  if (props.url === INTERNAL.downloads) return <DownloadsPage {...props} />;
  if (props.url === INTERNAL.bookmarks) return <BookmarksPage {...props} />;
  if (props.url === INTERNAL.settings) return <SettingsPage {...props} />;
  return <NewTabPage {...props} />;
}

function NewTabPage({ prefs, bookmarks, history, incognito, onNavigate }: InternalProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const sites = topSites(history);
  if (incognito)
    return (
      <div className="br-ntp br-ntp-incognito">
        <IncognitoIcon size={56} />
        <h1>{t('browser.incognitoTitle')}</h1>
        <p>{t('browser.incognitoText')}</p>
      </div>
    );
  return (
    <div className="br-ntp">
      <h1 className="br-ntp-title">{engineById(prefs.engine).label}</h1>
      <form
        className="br-ntp-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) onNavigate(resolveInput(query, prefs.engine));
        }}
      >
        <SearchIcon />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('browser.addressPlaceholder', { engine: engineById(prefs.engine).label })} aria-label={t('browser.address')} />
      </form>
      {(sites.length > 0 || bookmarks.length > 0) && (
        <div className="br-ntp-grid">
          {[...bookmarks.slice(0, 4).map((b) => ({ url: b.url, title: b.title })), ...sites]
            .filter((item, index, list) => list.findIndex((other) => hostOf(other.url) === hostOf(item.url)) === index)
            .slice(0, 10)
            .map((item) => (
              <button key={item.url} type="button" className="br-ntp-tile" onClick={() => onNavigate(item.url)} title={item.url}>
                <span className="br-ntp-icon">
                  <img src={faviconFor(item.url)} alt="" width={24} height={24} />
                </span>
                <span className="br-ntp-label">{item.title || hostOf(item.url)}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function HistoryPage({ history, setHistory, onNavigate, onOpenTab }: InternalProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState(false);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = history.filter((visit) => words.every((word) => `${visit.title} ${visit.url}`.toLowerCase().includes(word))).slice(0, 400);
  const groups = new Map<string, BrowserVisit[]>();
  for (const visit of list) {
    const day = new Date(visit.time).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    groups.set(day, [...(groups.get(day) ?? []), visit]);
  }
  return (
    <div className="br-page-doc">
      <div className="br-doc-head">
        <h1>{t('browser.page.history')}</h1>
        <input className="br-doc-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('browser.historySearch')} aria-label={t('browser.historySearch')} />
        {confirm ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="br-btn br-btn-danger"
              onClick={() => {
                void window.api.browser.clearHistory();
                setHistory([]);
                setConfirm(false);
              }}
            >
              {t('browser.confirmClear')}
            </button>
            <button type="button" className="br-btn" onClick={() => setConfirm(false)}>
              {t('browser.cancel')}
            </button>
          </span>
        ) : (
          <button type="button" className="br-btn" disabled={!history.length} onClick={() => setConfirm(true)}>
            {t('browser.clearHistory')}
          </button>
        )}
      </div>
      {!list.length && <p className="br-muted">{t(history.length ? 'browser.noMatches' : 'browser.historyEmpty')}</p>}
      {[...groups].map(([day, visits]) => (
        <section key={day} className="br-card">
          <h2 className="br-section-label">{day}</h2>
          {visits.map((visit) => (
            <div key={`${visit.url}:${visit.time}`} className="br-row br-row-link">
              <span className="br-muted br-time">{new Date(visit.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
              <img src={faviconFor(visit.url)} alt="" width={16} height={16} />
              <button type="button" className="br-row-title" onClick={(event) => (event.ctrlKey ? onOpenTab(visit.url) : onNavigate(visit.url))} onAuxClick={(event) => event.button === 1 && onOpenTab(visit.url)}>
                {visit.title || visit.url}
              </button>
              <span className="br-muted br-row-url">{hostOf(visit.url)}</span>
              <button
                type="button"
                className="br-link"
                aria-label={t('browser.ctx.remove')}
                onClick={() => {
                  void window.api.browser.removeVisit(visit.url, visit.time);
                  setHistory(history.filter((item) => item !== visit));
                }}
              >
                {t('browser.ctx.remove')}
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function DownloadsPage({ downloads, setDownloads }: InternalProps) {
  const t = useT();
  return (
    <div className="br-page-doc">
      <div className="br-doc-head">
        <h1>{t('browser.page.downloads')}</h1>
        <button
          type="button"
          className="br-btn"
          disabled={!downloads.some((item) => item.state !== 'progressing' && item.state !== 'paused')}
          onClick={() => {
            void window.api.browser.clearDownloads();
            setDownloads(downloads.filter((item) => item.state === 'progressing' || item.state === 'paused'));
          }}
        >
          {t('browser.clearAll')}
        </button>
      </div>
      {!downloads.length && <p className="br-muted">{t('browser.downloadsEmpty')}</p>}
      <section className="br-card">
        {downloads.map((item) => (
          <DownloadRow key={item.id} item={item} />
        ))}
      </section>
    </div>
  );
}

function BookmarksPage({ bookmarks, saveBookmarks, onNavigate }: InternalProps) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const move = (index: number, delta: number) => {
    const next = [...bookmarks];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
    saveBookmarks(next);
  };
  return (
    <div className="br-page-doc">
      <div className="br-doc-head">
        <h1>{t('browser.page.bookmarks')}</h1>
      </div>
      {!bookmarks.length && <p className="br-muted">{t('browser.bookmarksEmpty')}</p>}
      <section className="br-card">
        {bookmarks.map((bookmark, index) => (
          <div key={bookmark.id} className="br-row br-row-link">
            <img src={faviconFor(bookmark.url)} alt="" width={16} height={16} />
            {editing === bookmark.id ? (
              <form
                className="flex min-w-0 flex-1 gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  saveBookmarks(bookmarks.map((item) => (item.id === bookmark.id ? { ...item, title: String(data.get('title') ?? ''), url: String(data.get('url') ?? item.url) } : item)));
                  setEditing(null);
                }}
              >
                <input className="br-doc-search" name="title" defaultValue={bookmark.title} aria-label={t('browser.bm.name')} autoFocus />
                <input className="br-doc-search flex-1" name="url" defaultValue={bookmark.url} aria-label={t('browser.bm.url')} />
                <button type="submit" className="br-btn br-btn-primary">
                  {t('browser.save')}
                </button>
              </form>
            ) : (
              <>
                <button type="button" className="br-row-title" onClick={() => onNavigate(bookmark.url)}>
                  {bookmark.title || bookmark.url}
                </button>
                <span className="br-muted br-row-url">{displayUrl(bookmark.url)}</span>
                <button type="button" className="br-link" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t('browser.bm.up')}>
                  ↑
                </button>
                <button type="button" className="br-link" disabled={index === bookmarks.length - 1} onClick={() => move(index, 1)} aria-label={t('browser.bm.down')}>
                  ↓
                </button>
                <button type="button" className="br-link" onClick={() => setEditing(bookmark.id)}>
                  {t('browser.bm.edit')}
                </button>
                <button type="button" className="br-link" onClick={() => saveBookmarks(bookmarks.filter((item) => item.id !== bookmark.id))}>
                  {t('browser.ctx.remove')}
                </button>
              </>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function SettingsPage({ prefs, setPrefs, setHistory, setDownloads, downloads, onFlash }: InternalProps) {
  const t = useT();
  const [askWhere, setAskWhere] = useState(false);
  const [clear, setClear] = useState({ history: true, downloads: false, cookies: true, cache: true, permissions: false });
  const [sitePerms, setSitePerms] = useState<Record<string, Record<string, 'allow' | 'deny'>>>({});
  const [chrome, setChrome] = useState('');
  useEffect(() => {
    void window.api.browser.settings().then((value) => setAskWhere(value.askWhereToSave));
    void window.api.browser.permissions().then(setSitePerms);
    void window.api.appInfo().then((info) => setChrome(info.chrome));
  }, []);
  return (
    <div className="br-page-doc">
      <div className="br-doc-head">
        <h1>{t('browser.page.settings')}</h1>
      </div>

      <section className="br-card">
        <h2 className="br-section-label">{t('browser.set.search')}</h2>
        <div className="br-row">
          <span className="flex-1">{t('browser.set.engine')}</span>
          <select className="br-select" value={prefs.engine} onChange={(event) => setPrefs({ engine: event.target.value })}>
            {SEARCH_ENGINES.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.label}
              </option>
            ))}
          </select>
        </div>
        <div className="br-row">
          <span className="flex-1">{t('browser.set.home')}</span>
          <input className="br-doc-search" value={prefs.home === INTERNAL.newTab ? '' : prefs.home} placeholder={t('browser.newTab')} onChange={(event) => setPrefs({ home: event.target.value.trim() ? resolveInput(event.target.value, prefs.engine) : INTERNAL.newTab })} />
        </div>
        <label className="br-row">
          <span className="flex-1">{t('browser.menu.showBar')}</span>
          <input type="checkbox" checked={prefs.bookmarksBar} onChange={(event) => setPrefs({ bookmarksBar: event.target.checked })} />
        </label>
      </section>

      <section className="br-card">
        <h2 className="br-section-label">{t('browser.page.downloads')}</h2>
        <label className="br-row">
          <span className="flex-1">{t('browser.set.askWhere')}</span>
          <input
            type="checkbox"
            checked={askWhere}
            onChange={(event) => {
              setAskWhere(event.target.checked);
              void window.api.browser.setSettings({ askWhereToSave: event.target.checked });
            }}
          />
        </label>
      </section>

      <section className="br-card">
        <h2 className="br-section-label">{t('browser.menu.clearData')}</h2>
        {(['history', 'downloads', 'cookies', 'cache', 'permissions'] as const).map((key) => (
          <label key={key} className="br-row">
            <span className="flex-1">{t(`browser.clear.${key}` as Key)}</span>
            <input type="checkbox" checked={clear[key]} onChange={(event) => setClear({ ...clear, [key]: event.target.checked })} />
          </label>
        ))}
        <button
          type="button"
          className="br-btn br-btn-danger"
          onClick={() => {
            void window.api.browser.clearData(clear).then(() => {
              if (clear.history) setHistory([]);
              if (clear.downloads) setDownloads(downloads.filter((item) => item.state === 'progressing' || item.state === 'paused'));
              if (clear.permissions) setSitePerms({});
              onFlash(t('browser.cleared'));
            });
          }}
        >
          {t('browser.clearNow')}
        </button>
      </section>

      <section className="br-card">
        <h2 className="br-section-label">{t('browser.sitePermissions')}</h2>
        {!Object.keys(sitePerms).length && <p className="br-muted">{t('browser.noSitePermissions')}</p>}
        {Object.entries(sitePerms).map(([origin, perms]) => (
          <div key={origin} className="br-row">
            <span className="min-w-0 flex-1 truncate">{origin}</span>
            <span className="br-muted">
              {Object.entries(perms)
                .map(([name, value]) => `${t(`browser.perm.${name}` as Key)}: ${t(value === 'allow' ? 'browser.allowed' : 'browser.blocked')}`)
                .join(' · ')}
            </span>
            <button
              type="button"
              className="br-link"
              onClick={() => {
                void window.api.browser.resetPermissions(origin);
                const next = { ...sitePerms };
                delete next[origin];
                setSitePerms(next);
              }}
            >
              {t('browser.resetPermissions')}
            </button>
          </div>
        ))}
      </section>

      <section className="br-card">
        <h2 className="br-section-label">{t('browser.set.about')}</h2>
        <p className="br-muted">{t('browser.set.engineInfo', { version: chrome })}</p>
      </section>
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2 2.2 2 9.8 0 12M8 2c-2 2.2-2 9.8 0 12" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}
function StarSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="m8 2.4 1.7 3.5 3.85.55-2.8 2.7.67 3.8L8 11.15l-3.42 1.8.67-3.8-2.8-2.7 3.85-.55z" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
function WarnIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2 14.5 13.5h-13z" />
      <path d="M8 6.5v3.25M8 11.75h.01" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.25V11M8 5h.01" />
    </svg>
  );
}
function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
      <path d="M4 1.75h5L12.5 5v9.25h-8.5zM9 1.75V5h3.5" />
    </svg>
  );
}
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z" />
      {muted ? <path d="m11 6 3.5 4M14.5 6 11 10" /> : <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.75 3.75a6 6 0 0 1 0 8.5" />}
    </svg>
  );
}
function IncognitoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1.5 8h13M3.5 8l1.25-4.5h6.5L12.5 8" />
      <circle cx="4.75" cy="11" r="1.9" />
      <circle cx="11.25" cy="11" r="1.9" />
      <path d="M6.65 11c.85-.6 1.85-.6 2.7 0" />
    </svg>
  );
}
