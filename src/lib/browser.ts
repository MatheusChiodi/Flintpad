// Regras puras do navegador embutido: o que foi digitado na barra vira endereço ou busca,
// sugestões a partir do histórico e dos favoritos, e o nome dos atalhos de teclado.

export const SEARCH_ENGINES = [
  { id: 'google', label: 'Google', url: 'https://www.google.com/search?q=%s', home: 'https://www.google.com/' },
  { id: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q=%s', home: 'https://www.bing.com/' },
  { id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', home: 'https://duckduckgo.com/' },
  { id: 'ecosia', label: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', home: 'https://www.ecosia.org/' },
  { id: 'yahoo', label: 'Yahoo', url: 'https://search.yahoo.com/search?p=%s', home: 'https://www.yahoo.com/' },
] as const;
export type SearchEngineId = (typeof SEARCH_ENGINES)[number]['id'];

export const engineById = (id: string) => SEARCH_ENGINES.find((engine) => engine.id === id) ?? SEARCH_ENGINES[0];

/** Páginas internas (nova guia, histórico...), desenhadas pelo próprio app em vez de um site. */
export const INTERNAL = {
  newTab: 'flintpad://newtab',
  history: 'flintpad://history',
  downloads: 'flintpad://downloads',
  bookmarks: 'flintpad://bookmarks',
  settings: 'flintpad://settings',
} as const;
export const isInternal = (url: string) => url.startsWith('flintpad://');

const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const WEB_SCHEMES = /^(https?|file|about|data|view-source|chrome|blob|flintpad):/i;
const HOST = /^(localhost|(\d{1,3}\.){3}\d{1,3}|\[[\da-f:]+\]|([a-z\d-]+\.)+[a-z][a-z\d-]+)(:\d{1,5})?([/?#].*)?$/i;

export function searchUrl(query: string, engine: string): string {
  return engineById(engine).url.replace('%s', encodeURIComponent(query.trim()));
}

/** Texto da barra de endereço → URL: endereço quando parece um, senão busca no buscador escolhido. */
export function resolveInput(raw: string, engine: string): string {
  const text = raw.trim();
  if (!text) return INTERNAL.newTab;
  if (/^[a-z]:[\\/]/i.test(text) || text.startsWith('\\\\')) return `file:///${text.replace(/\\/g, '/').replace(/^\/+/, '')}`;
  if (WEB_SCHEMES.test(text)) return text;
  // "mailto:", "tel:" e afins seguem como estão; "nome:porta" sem ponto não é esquema.
  if (SCHEME.test(text) && !/^[^\s:]+:\d+/.test(text) && !/\s/.test(text)) return text;
  if (!/\s/.test(text) && HOST.test(text)) {
    const local = /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/i.test(text);
    return `${local ? 'http' : 'https'}://${text}`;
  }
  return searchUrl(text, engine);
}

/** Endereço como aparece na barra quando ela não está em foco: sem "https://" e sem a barra final. */
export function displayUrl(url: string): string {
  if (!url || url === INTERNAL.newTab) return '';
  return url.replace(/^https:\/\//, '').replace(/^(www\.)?([^/?#]+)\/$/, '$1$2');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function originOf(url: string): string {
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? '' : origin;
  } catch {
    return '';
  }
}

export type Visit = { url: string; title: string; time: number };
export type Bookmark = { id: string; url: string; title: string };
export type Suggestion = { kind: 'url' | 'search' | 'history' | 'bookmark'; url: string; title: string };

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Sugestões da barra: o que foi digitado (endereço ou busca), depois favoritos e histórico que combinam. */
export function suggest(raw: string, engine: string, bookmarks: Bookmark[], history: Visit[], limit = 8): Suggestion[] {
  const text = raw.trim();
  if (!text) return [];
  const target = resolveInput(text, engine);
  const first: Suggestion = target.startsWith(engineById(engine).url.split('%s')[0])
    ? { kind: 'search', url: target, title: text }
    : { kind: 'url', url: target, title: target };
  const words = fold(text).split(/\s+/).filter(Boolean);
  const matches = (item: { url: string; title: string }) => {
    const hay = fold(`${item.title} ${item.url}`);
    return words.every((word) => hay.includes(word));
  };
  const seen = new Set([first.url]);
  const out: Suggestion[] = [first];
  const push = (item: Suggestion) => {
    if (seen.has(item.url) || out.length >= limit) return;
    seen.add(item.url);
    out.push(item);
  };
  for (const bookmark of bookmarks) if (matches(bookmark)) push({ kind: 'bookmark', url: bookmark.url, title: bookmark.title });
  // Histórico: o endereço visitado mais vezes (e mais recente) primeiro.
  const counts = new Map<string, { visit: Visit; count: number }>();
  for (const visit of history) {
    if (!matches(visit)) continue;
    const entry = counts.get(visit.url);
    if (entry) {
      entry.count++;
      if (visit.time > entry.visit.time) entry.visit = visit;
    } else counts.set(visit.url, { visit, count: 1 });
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count || b.visit.time - a.visit.time);
  for (const { visit } of ranked) push({ kind: 'history', url: visit.url, title: visit.title || visit.url });
  // Se o que foi digitado parece endereço, a busca vem logo depois, como no Chrome.
  if (first.kind === 'url' && !/^[a-z]+:\/\/[^/]*\s/.test(text)) push({ kind: 'search', url: searchUrl(text, engine), title: text });
  return out;
}

/** Sites mais visitados para a página de nova guia. */
export function topSites(history: Visit[], limit = 8): Visit[] {
  const byHost = new Map<string, { visit: Visit; count: number }>();
  for (const visit of history) {
    if (!/^https?:/.test(visit.url)) continue;
    const host = hostOf(visit.url);
    const entry = byHost.get(host);
    if (entry) {
      entry.count++;
      if (visit.time > entry.visit.time) entry.visit = visit;
    } else byHost.set(host, { visit, count: 1 });
  }
  return [...byHost.values()].sort((a, b) => b.count - a.count || b.visit.time - a.visit.time).slice(0, limit).map((entry) => entry.visit);
}

/** Tecla pressionada no formato dos atalhos: "Ctrl+Shift+T", "Alt+ArrowLeft", "F5". */
export function comboOf(event: { key: string; ctrlKey?: boolean; control?: boolean; metaKey?: boolean; meta?: boolean; shiftKey?: boolean; shift?: boolean; altKey?: boolean; alt?: boolean }): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.control || event.metaKey || event.meta) parts.push('Ctrl');
  if (event.shiftKey || event.shift) parts.push('Shift');
  if (event.altKey || event.alt) parts.push('Alt');
  let key = event.key;
  if (key.length === 1) key = key.toUpperCase();
  if (key === '+') key = '=';
  parts.push(key);
  return parts.join('+');
}

/** Atalhos do Chrome que o navegador embutido atende (o resto vai para a página). */
export const BROWSER_SHORTCUTS = new Set([
  'Ctrl+T', 'Ctrl+N', 'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+W', 'Ctrl+F4', 'Ctrl+Shift+W',
  'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+PageDown', 'Ctrl+PageUp',
  'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9',
  'Ctrl+L', 'Alt+D', 'F6', 'Ctrl+K', 'Ctrl+E',
  'Ctrl+F', 'F3', 'Shift+F3', 'Ctrl+G', 'Ctrl+Shift+G',
  'Ctrl+R', 'F5', 'Ctrl+F5', 'Shift+F5', 'Ctrl+Shift+R',
  'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+Home', 'BrowserBack', 'BrowserForward',
  'Ctrl+D', 'Ctrl+Shift+B', 'Ctrl+Shift+O', 'Ctrl+H', 'Ctrl+J', 'Ctrl+Shift+Delete',
  'Ctrl+P', 'Ctrl+S', 'Ctrl+U', 'Ctrl+O',
  'F12', 'Ctrl+Shift+I', 'Ctrl+Shift+J', 'Ctrl+Shift+C',
  'Ctrl+=', 'Ctrl+-', 'Ctrl+0', 'Ctrl+Shift+=',
]);
