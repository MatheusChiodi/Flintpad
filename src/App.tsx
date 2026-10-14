import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { Editor, openLinkEvent } from './components/Editor';
import { Graph } from './components/Graph';
import { FolderIcon, GraphIcon, Kbd, Mark, NewPageIcon, PageIcon, PlusIcon, SearchIcon } from './components/Icons';
import { Presence, Stage } from './components/Motion';
import { LinksPanel, QuickSwitcher, TabBar } from './components/Panels';
import { Requests } from './components/Requests';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { Tasks } from './components/Tasks';
import { Toast, type ToastMessage } from './components/Toast';
import { handleCodeMenu } from './lib/codeBridge';
import { translate, Trans, useLanguage, useT } from './lib/i18n';
import { baseName, dirName, isRequestTarget, outgoingTargets, resolveLink, resolveRequestTarget, retargetLinks } from './lib/links';
import { focusRequest, getRequestIndex, loadRequestIndex } from './lib/requestIndex';
import { emptyPins, loadPins, prunePins, removePath, renamePath, savePins, toggleFavorite, touchRecent, type Pins } from './lib/pins';
import { CODE, GRAPH, isSpecialPath, REQUESTS, TASKS, WHITEBOARDS, type MenuAction, type Note, type Tab } from './types';

// O editor de código é pesado (Monaco): só é baixado quando a guia abre.
const Code = lazy(() => import('./components/Code'));
// Quadro branco: módulo isolado em src/whiteboard, também baixado só quando a guia abre.
const Whiteboards = lazy(() => import('./whiteboard'));

const MAX_EMPTY_RECENTS = 5;

const RAIL_STORAGE_KEY = 'obnotion:sidebar-rail';
const currentPath = (tab?: Tab) => tab?.stack[tab.idx] ?? '';

export default function App() {
  const t = useT();
  const { language } = useLanguage();
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
  const [switcher, setSwitcher] = useState(false);
  const [settings, setSettings] = useState(false);
  const [pins, setPins] = useState<Pins>(emptyPins);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const exporting = useRef(false);
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
    if (newTab || !active) {
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

  const closeTab = (id: number) => {
    const { tabs, activeId, closed } = latest.current;
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const path = currentPath(tabs[index]);
    if (path) setClosed([...closed, path]);
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (id === activeId) setActiveId(rest[Math.min(index, rest.length - 1)]?.id ?? 0);
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

  const createNote = async (name = t('note.untitled'), folder = '') => {
    const path = await window.api.create(`${folder}${name}.md`);
    await refresh();
    return path;
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
    open(resolveLink(target, latest.current.notes) ?? (await createNote(target)));
  };

  const renameNote = async (path: string, name: string) => {
    const renamed = await window.api.rename(path, `${dirName(path)}${name}.md`);
    setTabs(latest.current.tabs.map((t) => ({ ...t, stack: t.stack.map((p) => (p === path ? renamed : p)) })));
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
  };

  const deleteNote = async (path: string) => {
    await window.api.remove(path);
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

  const chooseVault = async () => {
    const chosen = await window.api.chooseVault();
    if (!chosen || chosen === vault) return;
    setTabs([]);
    setClosed([]);
    setVault(chosen);
    loadVaultPins(chosen, await refresh());
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
    const notify = (kind: ToastMessage['kind'], text: string, detail?: string) => setToast({ id: Date.now(), kind, text, detail });
    try {
      const result = await window.api.exportPdf(note.name);
      if (result?.path) notify('ok', translate('export.saved'), result.path);
      else if (result) notify('error', translate('export.failed'), result.error);
    } catch (error) {
      notify('error', translate('export.failed'), error instanceof Error ? error.message : String(error));
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
  const openDaily = async () => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const path = `${translate('daily.folder')}/${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.md`;
    if (!latest.current.notes.some((n) => n.path === path)) {
      await window.api.create(path);
      await refresh();
    }
    open(path);
  };

  const menu: Record<MenuAction, () => void> = {
    'new-note': async () => open(await createNote()),
    'new-tab': () => open('', true),
    'reopen-tab': reopenTab,
    'close-tab': () => closeTab(latest.current.activeId),
    'choose-vault': chooseVault,
    settings: () => {
      setSwitcher(false);
      setSettings(true);
    },
    'export-pdf': () => void exportPdf(),
    'copy-link': () => copyActive((n) => `[[${n.name}]]`),
    'copy-name': () => copyActive((n) => n.name),
    'toggle-favorite': toggleActiveFavorite,
    'quick-switcher': () => {
      setSettings(false);
      setSwitcher(true);
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
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const openTargetRef = useRef(openTarget);
  openTargetRef.current = openTarget;

  useEffect(() => {
    void window.api.getVault().then(async (path) => {
      setVault(path);
      if (!path) return;
      void loadRequestIndex();
      const list = await refresh();
      loadVaultPins(path, list);
      const start = window.api.startNote;
      if (start) open(isSpecialPath(start) || list.some((n) => n.path === start) ? start : GRAPH);
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

  const backlinks = useMemo(
    () => (isNote ? notes.filter((n) => edges.some(([from, to]) => to === activePath && from === n.path)) : []),
    [isNote, notes, edges, activePath],
  );
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

  if (vault === undefined) return null;

  const settingsModal = (
    <Presence when={settings} name="settings">
      <Settings vault={vault} onChooseVault={chooseVault} onClose={() => setSettings(false)} />
    </Presence>
  );

  if (vault === null) {
    return (
      <div className="frame flex h-full items-center justify-center gap-20 overflow-y-auto px-10 py-8">
        <div className="stagger max-w-[440px]">
          <div className="flex items-center gap-2.5">
            <Mark size={26} />
            <span className="font-display text-lg font-semibold tracking-tight text-frost-100">ObNotion</span>
          </div>
          <h1 className="mt-9 font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.025em] text-frost-100">
            {t('welcome.title')}
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-frost-300">
            {t('welcome.body')}
          </p>
          <button className="button-primary mt-8" onClick={chooseVault}>
            <FolderIcon />
            {t('welcome.choose')}
          </button>
          <ul className="mt-10 flex flex-col gap-2.5 border-t border-(--hairline) pt-6 text-[13px] text-frost-500">
            <li className="flex items-center gap-2.5">
              <PageIcon className="text-sheen-400" />
              {t('welcome.feature.files')}
            </li>
            <li className="flex items-center gap-2.5">
              <GraphIcon className="text-sheen-400" />
              {t('welcome.feature.links')}
            </li>
            <li className="flex items-center gap-2.5">
              <PlusIcon className="text-sheen-400" />
              <span>
                <Trans k="welcome.feature.blocks" values={{ key: <Kbd>/</Kbd> }} />
              </span>
            </li>
          </ul>
        </div>

        {/* Amostra do produto: a folha encaixada na obsidiana. Decorativa. */}
        <div className="relative hidden w-[360px] shrink-0 min-[980px]:block" aria-hidden="true">
          <svg
            className="constellation absolute -left-14 -top-24 text-sheen-400"
            width="460"
            height="150"
            viewBox="0 0 460 150"
            fill="none"
          >
            <path
              d="M96 150 150 62l96-34 104 46 62-52M150 62 60 40M350 74l-40 76M246 28l-30 122"
              stroke="currentColor"
              strokeOpacity="0.25"
              pathLength={1}
            />
            <circle cx="150" cy="62" r="6" fill="currentColor" />
            <circle cx="246" cy="28" r="4" fill="currentColor" fillOpacity="0.75" />
            <circle cx="350" cy="74" r="7.5" fill="currentColor" />
            <circle cx="412" cy="22" r="3.5" fill="currentColor" fillOpacity="0.6" />
            <circle cx="60" cy="40" r="3" fill="currentColor" fillOpacity="0.5" />
          </svg>
          <div className="welcome-sheet relative px-8 pb-9 pt-7">
            <p className="font-mono text-[10.5px] text-ink-faint">{t('welcome.sample.path')}</p>
            <p className="mt-3 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em]">{t('welcome.sample.title')}</p>
            <p className="mt-3 text-[13.5px] leading-relaxed">
              <Trans
                k="welcome.sample.body"
                values={{
                  budget: <span className="wikilink">{t('welcome.sample.budget')}</span>,
                  plan: <span className="wikilink">{t('welcome.sample.plan')}</span>,
                }}
              />
            </p>
            <ul className="mt-4 flex flex-col gap-2 text-[13.5px]">
              <li className="flex items-center gap-2.5 text-ink-faint line-through">
                <span className="grid h-3.5 w-3.5 place-items-center rounded-[3px] bg-sheen-700 text-[9px] text-white no-underline">
                  ✓
                </span>
                {t('welcome.sample.done')}
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-3.5 w-3.5 rounded-[3px] border border-ink-faint" />
                {t('welcome.sample.todo')}
              </li>
            </ul>
          </div>
        </div>
        {settingsModal}
      </div>
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
          onNew={async (folder) => open(await createNote(undefined, folder))}
          onDelete={deleteNote}
          onGraph={() => open(GRAPH, true)}
          onDaily={() => void openDaily()}
          onTasks={openTasks}
          onWhiteboards={openWhiteboards}
          onRequests={openRequests}
          onCode={openCode}
          onSearch={() => setSwitcher(true)}
          onSettings={() => setSettings(true)}
          rail={rail}
          onToggleRail={toggleRail}
        />
      </Presence>

      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} onNew={() => open('', true)} onShowSidebar={sidebar ? undefined : () => setSidebar(true)} />
        {/* Só na impressão: o título da tela é um campo de uma linha, que cortaria nomes longos no PDF. */}
        {isNote && <h1 className="print-title">{baseName(activePath)}</h1>}
        <Stage
          swapKey={`${activeId}:${activePath}`}
          material={isNote ? 'sheet' : 'well'}
          className={`min-h-0 flex-1 overflow-y-auto ${isNote ? 'mx-2 mb-2' : ''}`}
        >
          {activePath === REQUESTS ? (
            <Requests notes={notes} contents={contents} onOpenNote={(path) => open(path)} />
          ) : activePath === CODE ? (
            <Suspense fallback={<p className="p-5 text-frost-500">{t('code.loading')}</p>}>
              <Code />
            </Suspense>
          ) : activePath === WHITEBOARDS ? (
            <Suspense fallback={<p className="p-5 text-frost-500">{t('code.loading')}</p>}>
              <Whiteboards />
            </Suspense>
          ) : activePath === TASKS ? (
            <Tasks notes={notes} contents={contents} onOpen={open} onSaved={saved} />
          ) : activePath === GRAPH ? (
            <Graph notes={notes} edges={edges} onOpen={(path) => open(path)} />
          ) : isNote ? (
            <Editor
              // A língua entra na chave: o dicionário do editor de blocos é fixado na criação.
              key={`${activeId}:${activePath}:${language}`}
              path={activePath}
              notes={notes}
              favorite={favorite}
              onToggleFavorite={toggleActiveFavorite}
              onSaved={saved}
              onRename={renameNote}
            />
          ) : (
            <div className="stagger flex h-full flex-col items-center justify-center px-6 text-center">
              <Mark size={40} className="opacity-80" />
              <p className="mt-5 font-display text-[22px] font-semibold tracking-tight text-frost-100">
                {t('empty.title')}
              </p>
              <p className="mt-1.5 text-[13px] text-frost-500">{t('empty.hint')}</p>
              <dl className="mt-7 grid grid-cols-[auto_auto] items-center gap-x-5 gap-y-2.5 text-left text-[13px] text-frost-300">
                <dt className="flex items-center gap-2.5">
                  <SearchIcon className="text-frost-500" />
                  {t('empty.search')}
                </dt>
                <dd className="justify-self-end">
                  <Kbd>Ctrl P</Kbd>
                </dd>
                <dt className="flex items-center gap-2.5">
                  <NewPageIcon className="text-frost-500" />
                  {t('empty.create')}
                </dt>
                <dd className="justify-self-end">
                  <Kbd>Ctrl N</Kbd>
                </dd>
                <dt className="flex items-center gap-2.5">
                  <GraphIcon className="text-frost-500" />
                  {t('empty.graph')}
                </dt>
                <dd className="justify-self-end">
                  <Kbd>Ctrl G</Kbd>
                </dd>
              </dl>
              {recentNotes.length > 0 && (
                <div className="mt-7 w-64 max-w-full border-t border-(--hairline) pt-4 text-left">
                  <p className="section-label px-2 pb-1.5">{t('recents.title')}</p>
                  {recentNotes.slice(0, MAX_EMPTY_RECENTS).map((note) => (
                    <button
                      key={note.path}
                      className="row w-full px-2 text-left text-[13px]"
                      title={note.path}
                      onClick={(event) => open(note.path, event.ctrlKey || event.metaKey)}
                    >
                      <PageIcon size={14} className="row-icon" />
                      <span className="truncate">{note.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Stage>
      </main>

      <Presence when={isNote} name="links">
        <LinksPanel backlinks={backlinks} outgoing={outgoing} favorite={favorite} onToggleFavorite={toggleActiveFavorite} onOpen={(path) => open(path)} onOpenTarget={openTarget} />
      </Presence>

      <Presence when={switcher} name="switcher">
        <QuickSwitcher
          notes={notes}
          contents={contents}
          recents={recentNotes}
          onOpen={(path) => open(path)}
          onCreate={async (name) => open(await createNote(name))}
          onClose={() => setSwitcher(false)}
        />
      </Presence>

      {settingsModal}

      <Presence when={Boolean(toast)} name="toast">
        <Toast message={toast} onClose={() => setToast(null)} />
      </Presence>
    </div>
  );
}
