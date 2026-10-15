import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DailyNav } from './components/DailyNav';
import { discardNote, Editor, findOpenEvent, flushNote, insertMarkdown, openLinkEvent, pendingWrite, trackWrite } from './components/Editor';
import { LinkPreview } from './components/LinkPreview';
import { Graph } from './components/Graph';
import { Home } from './components/Home';
import { Presence, Stage } from './components/Motion';
import { LinksPanel, QuickSwitcher, TabBar, type BacklinkItem, type Command, type Picker } from './components/Panels';
import { Requests } from './components/Requests';
import { Settings, type Shortcut } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { Tasks } from './components/Tasks';
import { Toast, type ToastMessage } from './components/Toast';
import { Welcome } from './components/Welcome';
import { handleCodeMenu } from './lib/codeBridge';
import { translate, useLanguage, useT, type Key } from './lib/i18n';
import { sanitizeFolder } from './lib/prefs';
import { usePrefs } from './lib/prefsContext';
import { baseName, dirName, isRequestTarget, outgoingTargets, resolveLink, resolveRequestTarget, retargetLinks, splitFrontmatter } from './lib/links';
import { focusRequest, getRequestIndex, loadRequestIndex } from './lib/requestIndex';
import { gotoHeading } from './lib/noteBridge';
import { applyTemplate, dailyNeighbors, extractHeadings, folderList, isDailyNote, isoDate, linkContexts, templatesIn, linkMentions, parseLinkTarget, sanitizeNotePath, tagIndex, unlinkedMentions } from './lib/notes';
import { clearRecents, emptyPins, loadPins, prunePins, removePath, removeRecent, renamePath, savePins, toggleFavorite, touchRecent, type Pins } from './lib/pins';
import { closeOthers, closeToRight, loadSession, moveTab, restoreSession, saveSession, togglePin } from './lib/tabs';
import { CODE, GRAPH, isSpecialPath, REQUESTS, TASKS, WHITEBOARDS, type MenuAction, type Note, type Tab } from './types';

// O editor de código é pesado (Monaco): só é baixado quando a guia abre.
const Code = lazy(() => import('./components/Code'));
// Quadro branco: módulo isolado em src/whiteboard, também baixado só quando a guia abre.
const Whiteboards = lazy(() => import('./whiteboard'));

const RAIL_STORAGE_KEY = 'obnotion:sidebar-rail';
const currentPath = (tab?: Tab) => tab?.stack[tab.idx] ?? '';

export default function App() {
  const t = useT();
  const { language } = useLanguage();
  const { prefs, setPrefs } = usePrefs();
  // Pasta onde Ctrl N cria páginas, por vault (como a "localização padrão" do Obsidian).
  const [newNoteFolder, setNewNoteFolder] = useState('');
  const [startDaily, setStartDaily] = useState(false);
  // undefined = carregando; null = nenhum vault escolhido.
  const [vault, setVault] = useState<string | null | undefined>(undefined);
  const [notes, setNotes] = useState<Note[]>([]);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState(0);
  const [closed, setClosed] = useState<string[]>([]);
  const [sidebar, setSidebar] = useState(true);
  // Trilho de ícones: a escolha fica guardada entre sessões.
  const [rail, setRail] = useState(() => {
    try {
      return localStorage.getItem(RAIL_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleRail = () =>
    setRail((current) => {
      try {
        localStorage.setItem(RAIL_STORAGE_KEY, current ? '0' : '1');
      } catch {
        // armazenamento indisponível: vale só nesta sessão
      }
      return !current;
    });
  // Busca rápida: fechada (null), com um texto inicial (tag:x, >) ou como lista de escolha.
  const [switcher, setSwitcher] = useState<{ query?: string; picker?: Picker } | null>(null);
  const [settings, setSettings] = useState(false);
  const [pins, setPins] = useState<Pins>(emptyPins);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [widePaths, setWidePaths] = useState<Set<string>>(new Set());
  const exporting = useRef(false);
  // Vault cuja sessão de guias já foi restaurada: antes disso, gravar apagaria a sessão salva.
  const sessionVault = useRef<string | null>(null);
  const nextId = useRef(1);
  // Favoritos e recentes do vault aberto: a referência guarda de qual vault são, para gravar na chave certa.
  const pinStore = useRef<{ vault: string | null; pins: Pins }>({ vault: null, pins: emptyPins });

  // Handlers de menu e de eventos globais leem sempre o estado mais recente.
  const latest = useRef({ tabs, activeId, notes, closed });
  latest.current = { tabs, activeId, notes, closed };

  const activeTab = tabs.find((t) => t.id === activeId);
  const activePath = currentPath(activeTab);
  const isNote = Boolean(activePath) && !isSpecialPath(activePath);

  const refresh = async () => {
    const all = await window.api.readAll();
    const list = all.map(({ path }) => ({ path, name: baseName(path) }));
    setNotes(list);
    setContents(Object.fromEntries(all.map((n) => [n.path, n.content])));
    return list;
  };

  const updatePins = (change: (pins: Pins) => Pins) => {
    const store = pinStore.current;
    const next = change(store.pins);
    if (!store.vault || next === store.pins) return;
    store.pins = next;
    savePins(store.vault, next);
    setPins(next);
  };

  // As listas são por vault. Só as recentes são podadas na carga: se a listagem vier incompleta
  // (pasta em nuvem ainda sincronizando), os favoritos não se perdem; a barra lateral esconde os que faltam.
  const loadVaultPins = (path: string, list: Note[]) => {
    try {
      const wide = JSON.parse(localStorage.getItem(`obnotion:wide:${path}`) ?? '[]');
      setWidePaths(new Set(Array.isArray(wide) ? wide.filter((item): item is string => typeof item === 'string') : []));
    } catch {
      setWidePaths(new Set());
    }
    try {
      setNewNoteFolder(sanitizeFolder(localStorage.getItem(`obnotion:new-folder:${path}`)));
    } catch {
      setNewNoteFolder('');
    }
    const stored = loadPins(path);
    const loaded = { ...stored, recents: prunePins(stored, list.map((n) => n.path)).recents };
    pinStore.current = { vault: path, pins: loaded };
    setPins(loaded);
  };

  const toggleFavoriteAt = (path: string) => updatePins((current) => toggleFavorite(current, path));
  const toggleActiveFavorite = () => {
    const { tabs, activeId, notes } = latest.current;
    const path = currentPath(tabs.find((t) => t.id === activeId));
    if (notes.some((n) => n.path === path)) toggleFavoriteAt(path);
  };

  const open = (path: string, newTab = false) => {
    const { tabs, activeId } = latest.current;
    const active = tabs.find((t) => t.id === activeId);
    // Guia fixada não troca de página: o link abre ao lado (como no Obsidian).
    if (newTab || !active || (active.pinned && currentPath(active) && currentPath(active) !== path)) {
      const id = nextId.current++;
      setTabs([...tabs, { id, stack: [path], idx: 0 }]);
      setActiveId(id);
    } else if (currentPath(active) !== path) {
      setTabs(
        tabs.map((t) =>
          t.id === activeId ? { ...t, stack: [...t.stack.slice(0, t.idx + 1), path].filter(Boolean), idx: t.stack[t.idx] ? t.idx + 1 : 0 } : t,
        ),
      );
    }
  };

  // Ctrl+W não fecha guia fixada; o X, o menu e o clique do meio (force) fecham.
  const closeTab = (id: number, force = false) => {
    const { tabs, activeId, closed } = latest.current;
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0 || (tabs[index].pinned && !force)) return;
    const path = currentPath(tabs[index]);
    if (path) setClosed([...closed, path]);
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (id === activeId) setActiveId(rest[Math.min(index, rest.length - 1)]?.id ?? 0);
  };

  // Fechar várias de uma vez (outras, à direita): as que saem entram na lista de reabrir.
  const replaceTabs = (next: Tab[], keepId: number) => {
    const { tabs, activeId, closed } = latest.current;
    if (next === tabs) return;
    const gone = tabs.filter((tab) => !next.includes(tab)).map(currentPath).filter(Boolean);
    setClosed([...closed, ...gone]);
    setTabs(next);
    if (!next.some((tab) => tab.id === activeId)) setActiveId(keepId);
  };
  const tabCommands = {
    pin: (id: number) => setTabs(togglePin(latest.current.tabs, id)),
    closeOthers: (id: number) => replaceTabs(closeOthers(latest.current.tabs, id), id),
    closeRight: (id: number) => replaceTabs(closeToRight(latest.current.tabs, id), id),
    move: (id: number, to: number) => setTabs(moveTab(latest.current.tabs, id, to)),
    duplicate: (id: number) => {
      const tab = latest.current.tabs.find((item) => item.id === id);
      if (tab && currentPath(tab)) open(currentPath(tab), true);
    },
    copyLink: (id: number) => {
      const path = currentPath(latest.current.tabs.find((item) => item.id === id));
      if (path && !isSpecialPath(path)) void navigator.clipboard.writeText(`[[${baseName(path)}]]`);
    },
  };

  const reopenTab = () => {
    const { closed, notes } = latest.current;
    const path = [...closed].reverse().find((p) => isSpecialPath(p) || notes.some((n) => n.path === p));
    if (!path) return;
    setClosed(closed.slice(0, closed.lastIndexOf(path)));
    open(path, true);
  };

  const navigate = (delta: number) => {
    const { tabs, activeId } = latest.current;
    setTabs(
      tabs.map((t) => (t.id === activeId ? { ...t, idx: Math.max(0, Math.min(t.stack.length - 1, t.idx + delta)) } : t)),
    );
  };

  const cycleTab = (delta: number) => {
    const { tabs, activeId } = latest.current;
    if (!tabs.length) return;
    const index = tabs.findIndex((t) => t.id === activeId);
    setActiveId(tabs[(index + delta + tabs.length) % tabs.length].id);
  };

  const notify = (kind: ToastMessage['kind'], text: string, detail?: string) => setToast({ id: Date.now(), kind, text, detail });
  // Erros do processo principal chegam embrulhados ("Error invoking remote method 'x': Error: …"): fica só o motivo.
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');

  // O nome vem de quem digitou (busca rápida, link para página nova): sai limpo para o disco e para o link.
  const createNote = async (name = t('note.untitled'), folder = '') => {
    const path = await window.api.create(`${folder}${sanitizeNotePath(name) || t('note.untitled')}.md`);
    await refresh();
    return path;
  };

  // Página gerada por outra tela (resposta ou documentação de requests): cria, grava e abre.
  const createNoteWith = async (name: string, content: string) => {
    const path = await window.api.create(`${sanitizeNotePath(name) || t('note.untitled')}.md`);
    await window.api.write(path, content);
    await refresh();
    open(path);
  };

  // Versão para ações do usuário: uma falha vira aviso em vez de exceção solta.
  const createAndOpen = async (name?: string, folder?: string) => {
    try {
      open(await createNote(name, folder));
    } catch (error) {
      notify('error', translate('notes.error.create'), reason(error));
    }
  };

  const openTarget = async (target: string) => {
    // Link para request (.bru): abre a aba Requests já nela, em vez de criar uma página.
    if (isRequestTarget(target)) {
      const path = resolveRequestTarget(target, getRequestIndex()) ?? resolveRequestTarget(target, await loadRequestIndex());
      if (!path) return setToast({ id: Date.now(), kind: 'error', text: translate('requests.notFound', { target }) });
      focusRequest(path);
      openRequests();
      return;
    }
    // [[Página#Seção]]: abre a página e rola até o título.
    const { target: name, section } = parseLinkTarget(target);
    const existing = resolveLink(name, latest.current.notes);
    if (!existing) return createAndOpen(name);
    if (section) gotoHeading({ path: existing, text: section });
    open(existing);
  };

  // Renomear e mover são a mesma operação: o arquivo muda de caminho e os links acompanham.
  const relocate = async (path: string, target: string, failure: Key = 'notes.error.rename') => {
    if (target === path) return;
    let renamed: string;
    try {
      // O editor da página grava o que ainda está pendente antes: depois seria tarde (o arquivo mudou de nome).
      flushNote(path);
      await pendingWrite(path);
      renamed = await window.api.rename(path, target);
    } catch (error) {
      notify('error', translate(failure), reason(error));
      await refresh();
      return;
    }
    setTabs(latest.current.tabs.map((t) => ({ ...t, stack: t.stack.map((p) => (p === path ? renamed : p)) })));
    setClosed(latest.current.closed.map((p) => (p === path ? renamed : p)));
    updatePins((current) => renamePath(current, path, renamed));
    // Como no Obsidian, os links das outras páginas acompanham o novo nome.
    // A própria página fica de fora: ela está aberta no editor, que regravaria por cima.
    const all = await window.api.readAll();
    await Promise.all(
      all.map(({ path: other, content }) => {
        const updated = other === renamed ? content : retargetLinks(content, path, baseName(renamed));
        return updated === content ? undefined : window.api.write(other, updated);
      }),
    );
    await refresh();
    return renamed;
  };

  const renameNote = (path: string, name: string) => relocate(path, `${dirName(path)}${name}.md`);

  const moveNote = async (path: string, folder: string) => {
    const moved = await relocate(path, `${folder}${baseName(path)}.md`, 'notes.error.move');
    if (moved) notify('ok', translate('move.done', { name: baseName(moved), folder: folder ? folder.replace(/\/$/, '') : translate('move.root') }));
  };

  // Mover pela lista de pastas (menu de contexto ou paleta): a mesma janela da busca rápida.
  const pickFolderFor = (path: string) => {
    const here = dirName(path);
    setSwitcher({
      picker: {
        placeholder: translate('move.placeholder', { name: baseName(path) }),
        empty: translate('move.empty'),
        items: folderList(latest.current.notes)
          .filter((folder) => folder !== here)
          .map((folder) => ({ id: folder, label: folder ? folder.replace(/\/$/, '') : translate('move.root') })),
        onPick: (folder) => void moveNote(path, folder),
      },
    });
  };

  const duplicateNote = async (path: string) => {
    try {
      flushNote(path);
      await pendingWrite(path);
      const content = await window.api.read(path);
      const copy = await window.api.create(`${dirName(path)}${baseName(path)} ${translate('notes.copySuffix')}.md`);
      await window.api.write(copy, content);
      await refresh();
      open(copy);
    } catch (error) {
      notify('error', translate('notes.error.create'), reason(error));
    }
  };

  const restoreNote = async (path: string, content: string, wasFavorite: boolean) => {
    try {
      const restored = await window.api.create(path);
      await window.api.write(restored, content);
      await refresh();
      if (wasFavorite) updatePins((current) => toggleFavorite(current, restored));
      open(restored);
    } catch (error) {
      notify('error', translate('notes.error.create'), reason(error));
    }
  };

  // A página vai para a lixeira do sistema; o aviso traz "Desfazer", que recria o arquivo com o mesmo texto.
  const deleteNote = async (path: string) => {
    let content = '';
    try {
      discardNote(path);
      await pendingWrite(path);
      content = await window.api.read(path);
      await window.api.remove(path);
    } catch (error) {
      return notify('error', translate('notes.error.delete'), reason(error));
    }
    const wasFavorite = pinStore.current.pins.favorites.includes(path);
    setToast({
      id: Date.now(),
      kind: 'ok',
      text: translate('notes.deleted', { name: baseName(path) }),
      action: { label: translate('notes.undo'), run: () => void restoreNote(path, content, wasFavorite) },
    });
    const { tabs, activeId } = latest.current;
    const rest = tabs
      .map((t) => {
        const stack = t.stack.filter((p) => p !== path);
        return { ...t, stack, idx: Math.min(t.idx, stack.length - 1) };
      })
      .filter((t) => t.stack.length);
    setTabs(rest);
    if (!rest.some((t) => t.id === activeId)) setActiveId(rest[0]?.id ?? 0);
    updatePins((current) => removePath(current, path));
    await refresh();
  };

  // As guias da última vez voltam ao abrir o vault (sem as páginas que sumiram nesse meio-tempo).
  const restoreTabs = (path: string, list: Note[]) => {
    const known = new Set(list.map((note) => note.path));
    const restored = restoreSession(loadSession(path), (item) => isSpecialPath(item) || known.has(item), nextId.current);
    nextId.current += restored.tabs.length;
    setTabs(restored.tabs);
    setActiveId(restored.activeId);
    sessionVault.current = path;
  };

  // Troca de vault: as guias, recentes e favoritos passam a ser os do novo vault.
  // Uma falha (pasta sumiu, sem permissão) vira aviso em vez de exceção solta.
  const switchVault = async (pick: () => Promise<string | null>) => {
    try {
      const chosen = await pick();
      if (!chosen || chosen === vault) return;
      setTabs([]);
      setClosed([]);
      setSettings(false);
      setVault(chosen);
      const list = await refresh();
      loadVaultPins(chosen, list);
      restoreTabs(chosen, list);
    } catch (error) {
      notify('error', translate('welcome.openFailed'), reason(error));
    }
  };
  const chooseVault = () => switchVault(() => window.api.chooseVault());
  const openVault = (folder: string) => switchVault(() => window.api.openVault(folder));

  const changeNewNoteFolder = (folder: string) => {
    const clean = sanitizeFolder(folder);
    setNewNoteFolder(clean);
    try {
      if (vault) localStorage.setItem(`obnotion:new-folder:${vault}`, clean);
    } catch {
      // armazenamento indisponível: vale só nesta sessão
    }
  };

  // Páginas de exemplo para um vault vazio: nunca sobrescrevem nada (create escolhe um nome livre).
  const createStarter = async () => {
    try {
      const pages: [name: Key, body: Key][] = [
        ['starter.home.name', 'starter.home.body'],
        ['starter.keys.name', 'starter.keys.body'],
        ['starter.ideas.name', 'starter.ideas.body'],
      ];
      let first = '';
      for (const [name, body] of pages) {
        const path = await window.api.create(`${translate(name)}.md`);
        await window.api.write(path, translate(body));
        first ||= path;
      }
      // Modelo da nota diária: Ctrl D passa a criar o dia com ele.
      const template = await window.api.create(`${translate('templates.folder')}/${translate('daily.folder')}.md`);
      await window.api.write(template, translate('starter.daily.body'));
      await refresh();
      open(first);
      notify('ok', translate('home.starter.done'));
    } catch (error) {
      notify('error', translate('notes.error.create'), reason(error));
      await refresh().catch(() => {});
    }
  };

  const copyActive = (format: (note: Note) => string) => {
    const { tabs, activeId, notes } = latest.current;
    const note = notes.find((n) => n.path === currentPath(tabs.find((t) => t.id === activeId)));
    if (note) void navigator.clipboard.writeText(format(note));
  };

  // Só notas viram PDF: nas outras guias a ação não faz nada.
  const exportPdf = async () => {
    const { tabs, activeId, notes } = latest.current;
    const note = notes.find((n) => n.path === currentPath(tabs.find((t) => t.id === activeId)));
    if (!note || exporting.current) return;
    exporting.current = true;
    try {
      const result = await window.api.exportPdf(note.name);
      if (result?.path) notify('ok', translate('export.saved'), result.path);
      else if (result) notify('error', translate('export.failed'), result.error);
    } catch (error) {
      notify('error', translate('export.failed'), reason(error));
    } finally {
      exporting.current = false;
    }
  };

  // Requests, Código, Tarefas e Quadros são guias únicas: se já existem, só recebem o foco.
  const openSingleton = (path: string) => {
    const existing = latest.current.tabs.find((t) => currentPath(t) === path);
    if (existing) setActiveId(existing.id);
    else open(path, true);
  };
  const openRequests = () => openSingleton(REQUESTS);
  const openCode = () => openSingleton(CODE);
  const openTasks = () => openSingleton(TASKS);
  const openWhiteboards = () => openSingleton(WHITEBOARDS);
  const saved = (path: string, content: string) => setContents((prev) => ({ ...prev, [path]: content }));

  // Nota de hoje: uma página por dia numa pasta própria, criada na primeira vez que é aberta.
  // Se a pasta de modelos tiver uma página com o nome da pasta do diário ("Modelos/Diário"), ela é o modelo.
  // Garante a nota de hoje (com o modelo, se houver) e devolve o caminho; falha vira exceção para quem chamou.
  const ensureDaily = async () => {
    const now = new Date();
    const folder = translate('daily.folder');
    const path = `${folder}/${isoDate(now)}.md`;
    if (!latest.current.notes.some((n) => n.path === path)) {
      const created = await window.api.create(path);
      const template = `${translate('templates.folder')}/${folder}.md`;
      if (latest.current.notes.some((n) => n.path === template)) {
        await window.api.write(created, applyTemplate(await window.api.read(template), { title: isoDate(now), date: now }));
      }
      await refresh();
    }
    return path;
  };
  const openDaily = async () => {
    try {
      open(await ensureDaily());
    } catch (error) {
      notify('error', translate('notes.error.create'), reason(error));
    }
  };

  // Modelos: páginas na pasta de modelos. Variáveis {{title}}, {{date}}, {{time}} e {{date:FORMATO}}.
  const pickTemplate = (mode: 'new' | 'insert') => {
    const folder = translate('templates.folder');
    const templates = templatesIn(latest.current.notes, folder);
    if (!templates.length) return notify('error', translate('templates.none', { folder }));
    const target = currentPath(latest.current.tabs.find((tab) => tab.id === latest.current.activeId));
    setSwitcher({
      picker: {
        placeholder: translate(mode === 'new' ? 'templates.pickNew' : 'templates.pickInsert'),
        empty: translate('templates.none', { folder }),
        items: templates.map((note) => ({ id: note.path, label: note.name, detail: note.path })),
        onPick: (path) => void fromTemplate(path, mode, target),
      },
    });
  };

  const fromTemplate = async (templatePath: string, mode: 'new' | 'insert', target: string) => {
    try {
      const now = new Date();
      const raw = await window.api.read(templatePath);
      if (mode === 'insert') {
        // O frontmatter do modelo não entra no meio da página.
        insertMarkdown(target, splitFrontmatter(applyTemplate(raw, { title: baseName(target), date: now }))[1]);
        return;
      }
      const path = await window.api.create(`${t('note.untitled')}.md`);
      await window.api.write(path, applyTemplate(raw, { title: baseName(path), date: now }));
      await refresh();
      open(path);
      // Página nova: o cursor vai para o título, pronto para dar o nome.
      requestAnimationFrame(() => window.setTimeout(() => document.querySelector<HTMLInputElement>('.title-input')?.select(), 300));
    } catch (error) {
      notify('error', translate('notes.error.create'), reason(error));
    }
  };

  // Largura cheia por página (como no Notion), lembrada neste computador.
  const toggleWide = (path: string) =>
    setWidePaths((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      if (vault) {
        try {
          localStorage.setItem(`obnotion:wide:${vault}`, JSON.stringify([...next]));
        } catch {
          // armazenamento indisponível: vale só nesta sessão
        }
      }
      return next;
    });

  const menu: Record<MenuAction, () => void> = {
    'new-note': () => void createAndOpen(undefined, newNoteFolder),
    'new-tab': () => open('', true),
    'reopen-tab': reopenTab,
    'close-tab': () => closeTab(latest.current.activeId),
    'choose-vault': chooseVault,
    settings: () => {
      setSwitcher(null);
      setSettings(true);
    },
    'export-pdf': () => void exportPdf(),
    'copy-link': () => copyActive((n) => `[[${n.name}]]`),
    'copy-name': () => copyActive((n) => n.name),
    'toggle-favorite': toggleActiveFavorite,
    'quick-switcher': () => {
      setSettings(false);
      setSwitcher({});
    },
    graph: () => open(GRAPH, true),
    'daily-note': () => void openDaily(),
    requests: () => openRequests(),
    code: () => openCode(),
    tasks: () => openTasks(),
    whiteboards: () => openWhiteboards(),
    'toggle-sidebar': () => setSidebar((visible) => !visible),
    'toggle-rail': () => {
      setSidebar(true);
      toggleRail();
    },
    back: () => navigate(-1),
    forward: () => navigate(1),
    'next-tab': () => cycleTab(1),
    'prev-tab': () => cycleTab(-1),
  };
  // Liga as menções do nome da página aberta numa outra página (painel "Menções sem link").
  const linkMentionIn = async (path: string) => {
    const current = currentPath(latest.current.tabs.find((tab) => tab.id === latest.current.activeId));
    if (!current || isSpecialPath(current)) return;
    try {
      await pendingWrite(path);
      const text = await window.api.read(path);
      const next = linkMentions(text, baseName(current));
      if (next === text) return;
      await trackWrite(path, window.api.write(path, next));
      saved(path, next);
      notify('ok', translate('mentions.linked', { name: baseName(path) }));
    } catch (error) {
      notify('error', translate('notes.error.save'), reason(error));
    }
  };

  const openRandom = () => {
    const pool = latest.current.notes;
    if (pool.length) open(pool[Math.floor(Math.random() * pool.length)].path);
  };

  // Paleta de comandos (">" na busca rápida). Os atalhos mostrados são os do menu.
  const commandList: [id: string, label: Key, keys: string | undefined, run: () => void, enabled?: boolean][] = [
    ['new-note', 'cmd.newNote', 'Ctrl N', menu['new-note']],
    ['daily-note', 'cmd.dailyNote', 'Ctrl D', menu['daily-note']],
    ['random-note', 'cmd.randomNote', undefined, openRandom, notes.length > 0],
    ['new-from-template', 'cmd.newFromTemplate', undefined, () => pickTemplate('new')],
    ['insert-template', 'cmd.insertTemplate', undefined, () => pickTemplate('insert'), isNote],
    ['toggle-wide', 'cmd.toggleWide', undefined, () => toggleWide(activePath), isNote],
    ['rename-note', 'cmd.renameNote', undefined, () => document.querySelector<HTMLInputElement>('.title-input')?.focus(), isNote],
    ['duplicate-note', 'cmd.duplicateNote', undefined, () => void duplicateNote(activePath), isNote],
    ['move-note', 'cmd.moveNote', undefined, () => pickFolderFor(activePath), isNote],
    ['delete-note', 'cmd.deleteNote', undefined, () => void deleteNote(activePath), isNote],
    ['find', 'cmd.find', 'Ctrl F', () => window.dispatchEvent(new Event(findOpenEvent)), isNote],
    [
      'goto-heading',
      'cmd.gotoHeading',
      undefined,
      // O Sumário também pela paleta: com a janela estreita o painel de links fica oculto.
      () =>
        setSwitcher({
          picker: {
            placeholder: translate('outline.pick'),
            empty: translate('outline.empty'),
            items: headings.map((heading, index) => ({ id: String(index), label: heading.text, detail: '#'.repeat(heading.level) })),
            onPick: (id) => gotoHeading({ path: activePath, text: headings[Number(id)]?.text ?? '', index: Number(id) }),
          },
        }),
      isNote,
    ],
    ['toggle-favorite', 'cmd.toggleFavorite', 'Ctrl Shift F', menu['toggle-favorite'], isNote],
    ['copy-link', 'cmd.copyLink', 'Ctrl L', menu['copy-link'], isNote],
    ['copy-name', 'cmd.copyName', 'Ctrl Alt L', menu['copy-name'], isNote],
    ['export-pdf', 'cmd.exportPdf', 'Ctrl Shift P', menu['export-pdf'], isNote],
    ['graph', 'cmd.graph', 'Ctrl G', menu.graph],
    ['tasks', 'cmd.tasks', 'Ctrl Shift J', menu.tasks],
    ['whiteboards', 'cmd.whiteboards', 'Ctrl Shift B', menu.whiteboards],
    ['requests', 'cmd.requests', 'Ctrl Shift E', menu.requests],
    ['code', 'cmd.code', 'Ctrl Shift K', menu.code],
    ['new-tab', 'cmd.newTab', 'Ctrl T', menu['new-tab']],
    ['close-tab', 'cmd.closeTab', 'Ctrl W', menu['close-tab'], tabs.length > 0],
    ['reopen-tab', 'cmd.reopenTab', 'Ctrl Shift T', menu['reopen-tab'], closed.length > 0],
    ['pin-tab', 'cmd.pinTab', undefined, () => tabCommands.pin(activeId), tabs.length > 0],
    ['close-other-tabs', 'cmd.closeOtherTabs', undefined, () => tabCommands.closeOthers(activeId), tabs.length > 1],
    ['back', 'cmd.back', 'Ctrl [', menu.back],
    ['forward', 'cmd.forward', 'Ctrl ]', menu.forward],
    ['toggle-sidebar', 'cmd.toggleSidebar', 'Ctrl \\', menu['toggle-sidebar']],
    ['toggle-rail', 'cmd.toggleRail', 'Ctrl Shift \\', menu['toggle-rail']],
    ['settings', 'cmd.settings', 'Ctrl ,', menu.settings],
    ['choose-vault', 'cmd.chooseVault', 'Ctrl O', menu['choose-vault']],
  ];
  // Lista de atalhos das Configurações: os da paleta mais os que só existem no menu ou no teclado.
  const shortcuts: Shortcut[] = [
    { label: t('empty.search'), keys: 'Ctrl P' },
    ...commandList.filter(([, , keys]) => keys).map(([, label, keys]) => ({ label: t(label), keys: keys! })),
    { label: t('settings.key.nextTab'), keys: 'Ctrl Tab' },
    { label: t('settings.key.prevTab'), keys: 'Ctrl Shift Tab' },
    { label: t('settings.key.zoom'), keys: 'Ctrl = / Ctrl -' },
    { label: t('settings.key.resetZoom'), keys: 'Ctrl 0' },
    { label: t('settings.key.fullscreen'), keys: 'F11' },
  ];
  const commands: Command[] = commandList
    .filter(([, , , , enabled]) => enabled !== false)
    .map(([id, label, keys, run]) => ({ id, label: t(label), keys, run }));

  const menuRef = useRef(menu);
  menuRef.current = menu;
  const openTargetRef = useRef(openTarget);
  openTargetRef.current = openTarget;

  useEffect(() => {
    void window.api.getVault().then(async (path) => {
      setVault(path);
      if (!path) return;
      void loadRequestIndex();
      // Pasta sumida (pendrive, nuvem fora do ar): a tela abre vazia com o motivo, em vez de quebrar.
      let list: Note[] = [];
      try {
        list = await refresh();
      } catch (error) {
        notify('error', translate('notes.error.load'), reason(error));
      }
      loadVaultPins(path, list);
      const start = window.api.startNote;
      if (start) open(isSpecialPath(start) || list.some((n) => n.path === start) ? start : GRAPH);
      // Preferência "Ao abrir o app": as guias de antes, essas mais a nota de hoje, ou a tela inicial.
      else if (prefs.startup === 'home') {
        sessionVault.current = path;
      } else {
        restoreTabs(path, list);
        // A nota de hoje abre depois que as guias restauradas e a lista de notas estiverem no estado.
        if (prefs.startup === 'daily') setStartDaily(true);
      }
    });
    const offMenu = window.api.onMenu((action) => {
      // Na aba Código, atalhos como Ctrl+P e Ctrl+Shift+P seguem o VS Code.
      const active = latest.current.tabs.find((tab) => tab.id === latest.current.activeId);
      if (active && currentPath(active) === CODE && handleCodeMenu(action)) return;
      menuRef.current[action]?.();
    });
    const onLink = (event: Event) => void openTargetRef.current((event as CustomEvent<string>).detail);
    window.addEventListener(openLinkEvent, onLink);
    return () => {
      offMenu();
      window.removeEventListener(openLinkEvent, onLink);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edges = useMemo(() => {
    const result: [string, string][] = [];
    for (const note of notes) {
      for (const target of outgoingTargets(contents[note.path] ?? '')) {
        const to = resolveLink(target, notes);
        if (to && to !== note.path) result.push([note.path, to]);
      }
    }
    return result;
  }, [notes, contents]);

  const activeNote = useMemo(() => notes.find((n) => n.path === activePath), [notes, activePath]);
  // Backlinks com o trecho em volta de cada link, como no painel do Obsidian.
  const backlinks = useMemo((): BacklinkItem[] => {
    if (!isNote || !activeNote) return [];
    return notes
      .filter((n) => edges.some(([from, to]) => to === activePath && from === n.path))
      .map((note) => ({ note, contexts: linkContexts(contents[note.path] ?? '', activeNote) }));
  }, [isNote, activeNote, notes, edges, activePath, contents]);
  const findMentions = useCallback(
    () => (activeNote ? unlinkedMentions(activeNote, notes, contents, new Set(backlinks.map((item) => item.note.path))) : []),
    [activeNote, notes, contents, backlinks],
  );
  const tags = useMemo(() => tagIndex(notes, contents), [notes, contents]);
  const outgoing = useMemo(
    () =>
      isNote
        ? outgoingTargets(contents[activePath] ?? '').map((target) => {
            if (!isRequestTarget(target)) return { target, path: resolveLink(target, notes) };
            const request = getRequestIndex().find((item) => item.path === resolveRequestTarget(target, getRequestIndex()));
            return { target, path: request?.path, label: request ? `${request.method.toUpperCase()} ${request.name}` : target };
          })
        : [],
    [isNote, contents, activePath, notes],
  );

  // Sumário: os títulos da página, a partir do que está gravado (atualiza a cada gravação).
  const headings = useMemo(() => (isNote ? extractHeadings(contents[activePath] ?? '') : []), [isNote, contents, activePath]);

  useEffect(() => {
    if (!startDaily) return;
    setStartDaily(false);
    void openDaily();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDaily]);

  useEffect(() => {
    if (vault && sessionVault.current === vault) saveSession(vault, tabs, activeId);
  }, [vault, tabs, activeId]);

  // Toda nota que passa pela guia ativa entra nas recentes (guias especiais e guia vazia, não).
  useEffect(() => {
    if (notes.some((n) => n.path === activePath)) updatePins((current) => touchRecent(current, activePath));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, notes]);

  const favorite = pins.favorites.includes(activePath);
  // A página aberta fica de fora: ela já está na tela.
  const recentNotes = useMemo(
    () => pins.recents.filter((path) => path !== activePath).flatMap((path) => notes.find((n) => n.path === path) ?? []),
    [pins.recents, notes, activePath],
  );

  const favoriteNotes = pins.favorites.flatMap((path) => notes.find((n) => n.path === path) ?? []);

  if (vault === undefined) return null;

  const settingsModal = (
    <Presence when={settings} name="settings">
      <Settings
        vault={vault}
        notes={notes}
        contents={contents}
        tagCount={tags.length}
        folders={folderList(notes)}
        newNoteFolder={newNoteFolder}
        onNewNoteFolder={changeNewNoteFolder}
        shortcuts={shortcuts}
        onChooseVault={() => void chooseVault()}
        onOpenVault={(folder) => void openVault(folder)}
        onNotify={notify}
        onClose={() => setSettings(false)}
      />
    </Presence>
  );

  const toastLayer = (
    <Presence when={Boolean(toast)} name="toast">
      <Toast message={toast} onClose={() => setToast(null)} />
    </Presence>
  );

  if (vault === null) {
    return (
      <>
        <Welcome
          onChoose={() => void chooseVault()}
          onOpen={(folder) => void openVault(folder)}
          onError={(detail) => notify('error', translate('welcome.openFailed'), detail)}
          onSettings={() => setSettings(true)}
        />
        {settingsModal}
        {toastLayer}
      </>
    );
  }

  return (
    <div className="frame flex h-full">
      <Presence when={sidebar} name="sidebar">
        <Sidebar
          vault={vault}
          notes={notes}
          activePath={activePath}
          favorites={pins.favorites}
          onToggleFavorite={toggleFavoriteAt}
          onOpen={open}
          onNew={(folder) => void createAndOpen(undefined, folder)}
          onDelete={(path) => void deleteNote(path)}
          onRename={(path, name) => void renameNote(path, name)}
          onDuplicate={(path) => void duplicateNote(path)}
          onMove={pickFolderFor}
          onMoveTo={(path, folder) => void moveNote(path, folder)}
          onCopyLink={(path) => void navigator.clipboard.writeText(`[[${baseName(path)}]]`)}
          onGraph={() => open(GRAPH, true)}
          onDaily={() => void openDaily()}
          onTasks={openTasks}
          onWhiteboards={openWhiteboards}
          onRequests={openRequests}
          onCode={openCode}
          onSearch={() => setSwitcher({})}
          tags={tags}
          onTag={(tag) => setSwitcher({ query: `tag:${tag} ` })}
          onSettings={() => setSettings(true)}
          rail={rail}
          onToggleRail={toggleRail}
        />
      </Presence>

      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
          onNew={() => open('', true)}
          onPin={tabCommands.pin}
          onCloseOthers={tabCommands.closeOthers}
          onCloseRight={tabCommands.closeRight}
          onMove={tabCommands.move}
          onDuplicate={tabCommands.duplicate}
          onCopyLink={tabCommands.copyLink}
          onShowSidebar={sidebar ? undefined : () => setSidebar(true)}
        />
        {/* Só na impressão: o título da tela é um campo de uma linha, que cortaria nomes longos no PDF. */}
        {isNote && <h1 className="print-title">{baseName(activePath)}</h1>}
        <Stage
          swapKey={`${activeId}:${activePath}`}
          material={isNote ? 'sheet' : 'well'}
          className={`min-h-0 flex-1 overflow-y-auto ${isNote ? 'mx-2 mb-2' : ''}`}
        >
          {activePath === REQUESTS ? (
            <Requests notes={notes} contents={contents} onOpenNote={(path) => open(path)} onCreateNote={createNoteWith} />
          ) : activePath === CODE ? (
            <Suspense fallback={<p className="p-5 text-frost-500">{t('code.loading')}</p>}>
              <Code />
            </Suspense>
          ) : activePath === WHITEBOARDS ? (
            <Suspense fallback={<p className="p-5 text-frost-500">{t('code.loading')}</p>}>
              <Whiteboards notes={notes} onOpenNote={(path) => open(path)} />
            </Suspense>
          ) : activePath === TASKS ? (
            <Tasks
              notes={notes}
              contents={contents}
              onOpen={open}
              onOpenTask={(task, newTab) => {
                open(task.path, newTab);
                gotoHeading({ path: task.path, text: task.text, index: task.index, task: true });
              }}
              onOpenTarget={(target) => void openTarget(target)}
              onEnsureDaily={ensureDaily}
              onSaved={saved}
            />
          ) : activePath === GRAPH ? (
            <Graph notes={notes} contents={contents} onOpen={(path, newTab) => open(path, newTab)} onCreate={(name) => void createAndOpen(name)} />
          ) : isNote ? (
            <Editor
              // A língua entra na chave: o dicionário do editor de blocos é fixado na criação.
              key={`${activeId}:${activePath}:${language}`}
              path={activePath}
              notes={notes}
              contents={contents}
              favorite={favorite}
              onToggleFavorite={toggleActiveFavorite}
              onSaved={saved}
              onRename={renameNote}
              onSaveError={(error) => notify('error', translate('notes.error.save'), reason(error))}
              wide={widePaths.has(activePath)}
              onToggleWide={() => toggleWide(activePath)}
              header={
                isDailyNote(activePath, t('daily.folder')) ? (
                  <DailyNav
                    path={activePath}
                    neighbors={dailyNeighbors(activePath, notes, t('daily.folder'))}
                    onOpen={(path) => open(path)}
                    onToday={() => void openDaily()}
                  />
                ) : undefined
              }
            />
          ) : (
            <Home
              notes={notes}
              contents={contents}
              tagCount={tags.length}
              favorites={favoriteNotes}
              recents={recentNotes}
              actions={{
                search: () => setSwitcher({}),
                create: menu['new-note'],
                daily: menu['daily-note'],
                graph: menu.graph,
                tasks: menu.tasks,
                whiteboards: menu.whiteboards,
                random: openRandom,
                template: () => pickTemplate('new'),
              }}
              onOpen={open}
              onRemoveRecent={(path) => updatePins((current) => removeRecent(current, path))}
              onClearRecents={() => updatePins(clearRecents)}
              onStarter={() => void createStarter()}
              showTips={prefs.tips}
              onHideTips={() => setPrefs({ tips: false })}
            />
          )}
        </Stage>
      </main>

      <Presence when={isNote} name="links">
        <LinksPanel
          backlinks={backlinks}
          outgoing={outgoing}
          headings={headings}
          onHeading={(index) => headings[index] && gotoHeading({ path: activePath, text: headings[index].text, index })}
          findMentions={findMentions}
          onLinkMention={(path) => void linkMentionIn(path)}
          favorite={favorite}
          onToggleFavorite={toggleActiveFavorite}
          onOpen={(path) => open(path)}
          onOpenTarget={openTarget}
        />
      </Presence>

      <LinkPreview notes={notes} contents={contents} onOpen={(path) => open(path)} />

      <Presence when={Boolean(switcher)} name="switcher">
        <QuickSwitcher
          // Cada abertura (texto inicial ou lista de escolha diferente) começa do zero.
          key={switcher?.picker?.placeholder ?? switcher?.query ?? ''}
          notes={notes}
          contents={contents}
          recents={recentNotes}
          commands={commands}
          initialQuery={switcher?.query}
          picker={switcher?.picker}
          onOpen={(path, newTab) => open(path, newTab)}
          // Nome sem pasta vai para a pasta padrão das páginas novas; "pasta/nome" é respeitado.
          onCreate={(name) => void createAndOpen(name, name.includes('/') ? '' : newNoteFolder)}
          onClose={() => setSwitcher(null)}
        />
      </Presence>

      {settingsModal}
      {toastLayer}
    </div>
  );
}
