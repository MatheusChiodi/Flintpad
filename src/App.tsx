import { useEffect, useMemo, useRef, useState } from 'react';

import { Editor, openLinkEvent } from './components/Editor';
import { Graph } from './components/Graph';
import { FolderIcon, GraphIcon, Kbd, Mark, NewPageIcon, PageIcon, PlusIcon, SearchIcon } from './components/Icons';
import { Presence, Stage } from './components/Motion';
import { LinksPanel, QuickSwitcher, TabBar } from './components/Panels';
import { Requests } from './components/Requests';
import { Sidebar } from './components/Sidebar';
import { baseName, dirName, outgoingTargets, resolveLink, retargetLinks } from './lib/links';
import { GRAPH, isSpecialPath, REQUESTS, type MenuAction, type Note, type Tab } from './types';

const UNTITLED = 'Sem título';
const currentPath = (tab?: Tab) => tab?.stack[tab.idx] ?? '';

export default function App() {
  // undefined = carregando; null = nenhum vault escolhido.
  const [vault, setVault] = useState<string | null | undefined>(undefined);
  const [notes, setNotes] = useState<Note[]>([]);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState(0);
  const [closed, setClosed] = useState<string[]>([]);
  const [sidebar, setSidebar] = useState(true);
  const [switcher, setSwitcher] = useState(false);
  const nextId = useRef(1);

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

  const createNote = async (name = UNTITLED, folder = '') => {
    const path = await window.api.create(`${folder}${name}.md`);
    await refresh();
    return path;
  };

  const openTarget = async (target: string) => {
    open(resolveLink(target, latest.current.notes) ?? (await createNote(target)));
  };

  const renameNote = async (path: string, name: string) => {
    const renamed = await window.api.rename(path, `${dirName(path)}${name}.md`);
    setTabs(latest.current.tabs.map((t) => ({ ...t, stack: t.stack.map((p) => (p === path ? renamed : p)) })));
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
    await refresh();
  };

  const chooseVault = async () => {
    const chosen = await window.api.chooseVault();
    if (!chosen || chosen === vault) return;
    setTabs([]);
    setClosed([]);
    setVault(chosen);
    await refresh();
  };

  const copyActive = (format: (note: Note) => string) => {
    const { tabs, activeId, notes } = latest.current;
    const note = notes.find((n) => n.path === currentPath(tabs.find((t) => t.id === activeId)));
    if (note) void navigator.clipboard.writeText(format(note));
  };

  // Requests é uma guia única: se já existe, só recebe o foco.
  const openRequests = () => {
    const existing = latest.current.tabs.find((t) => currentPath(t) === REQUESTS);
    if (existing) setActiveId(existing.id);
    else open(REQUESTS, true);
  };

  const menu: Record<MenuAction, () => void> = {
    'new-note': async () => open(await createNote()),
    'new-tab': () => open('', true),
    'reopen-tab': reopenTab,
    'close-tab': () => closeTab(latest.current.activeId),
    'choose-vault': chooseVault,
    'copy-link': () => copyActive((n) => `[[${n.name}]]`),
    'copy-name': () => copyActive((n) => n.name),
    'quick-switcher': () => setSwitcher(true),
    graph: () => open(GRAPH, true),
    requests: () => openRequests(),
    'toggle-sidebar': () => setSidebar((visible) => !visible),
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
      const list = await refresh();
      const start = window.api.startNote;
      if (start) open(start === REQUESTS || list.some((n) => n.path === start) ? start : GRAPH);
    });
    const offMenu = window.api.onMenu((action) => menuRef.current[action]?.());
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
        ? outgoingTargets(contents[activePath] ?? '').map((target) => ({ target, path: resolveLink(target, notes) }))
        : [],
    [isNote, contents, activePath, notes],
  );

  if (vault === undefined) return null;

  if (vault === null) {
    return (
      <div className="frame flex h-full items-center justify-center gap-20 overflow-y-auto px-10 py-8">
        <div className="stagger max-w-[440px]">
          <div className="flex items-center gap-2.5">
            <Mark size={26} />
            <span className="font-display text-lg font-semibold tracking-tight text-frost-100">ObNotion</span>
          </div>
          <h1 className="mt-9 font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.025em] text-frost-100">
            Suas notas, na sua pasta, em blocos.
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-frost-300">
            Suas notas ficam em arquivos Markdown numa pasta do seu computador. Escolha a pasta para começar; pode ser um
            vault do Obsidian que você já usa.
          </p>
          <button className="button-primary mt-8" onClick={chooseVault}>
            <FolderIcon />
            Escolher pasta do vault
          </button>
          <ul className="mt-10 flex flex-col gap-2.5 border-t border-(--hairline) pt-6 text-[13px] text-frost-500">
            <li className="flex items-center gap-2.5">
              <PageIcon className="text-sheen-400" />
              Arquivos .md comuns, sem conta e sem nuvem
            </li>
            <li className="flex items-center gap-2.5">
              <GraphIcon className="text-sheen-400" />
              Links entre páginas, backlinks e grafo
            </li>
            <li className="flex items-center gap-2.5">
              <PlusIcon className="text-sheen-400" />
              Editor de blocos com o menu <Kbd>/</Kbd>
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
            <p className="font-mono text-[10.5px] text-ink-faint">Projetos/Casa nova.md</p>
            <p className="mt-3 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em]">Casa nova</p>
            <p className="mt-3 text-[13.5px] leading-relaxed">
              Mudança marcada para março. O orçamento está em <span className="wikilink">Finanças</span> e as medidas
              dos cômodos em <span className="wikilink">Planta</span>.
            </p>
            <ul className="mt-4 flex flex-col gap-2 text-[13.5px]">
              <li className="flex items-center gap-2.5 text-ink-faint line-through">
                <span className="grid h-3.5 w-3.5 place-items-center rounded-[3px] bg-sheen-700 text-[9px] text-white no-underline">
                  ✓
                </span>
                Fechar o contrato
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-3.5 w-3.5 rounded-[3px] border border-ink-faint" />
                Pedir três orçamentos de frete
              </li>
            </ul>
          </div>
        </div>
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
          onOpen={open}
          onNew={async (folder) => open(await createNote(UNTITLED, folder))}
          onDelete={deleteNote}
          onGraph={() => open(GRAPH, true)}
          onRequests={openRequests}
          onSearch={() => setSwitcher(true)}
        />
      </Presence>

      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} onNew={() => open('', true)} />
        <Stage
          swapKey={`${activeId}:${activePath}`}
          material={isNote ? 'sheet' : 'well'}
          className={`min-h-0 flex-1 overflow-y-auto ${isNote ? 'mx-2 mb-2' : ''}`}
        >
          {activePath === REQUESTS ? (
            <Requests />
          ) : activePath === GRAPH ? (
            <Graph notes={notes} edges={edges} onOpen={(path) => open(path)} />
          ) : isNote ? (
            <Editor
              key={`${activeId}:${activePath}`}
              path={activePath}
              notes={notes}
              onSaved={(path, content) => setContents((prev) => ({ ...prev, [path]: content }))}
              onRename={renameNote}
            />
          ) : (
            <div className="stagger flex h-full flex-col items-center justify-center px-6 text-center">
              <Mark size={40} className="opacity-80" />
              <p className="mt-5 font-display text-[22px] font-semibold tracking-tight text-frost-100">
                Nenhuma página aberta
              </p>
              <p className="mt-1.5 text-[13px] text-frost-500">Escolha uma página na barra lateral ou use um atalho.</p>
              <dl className="mt-7 grid grid-cols-[auto_auto] items-center gap-x-5 gap-y-2.5 text-left text-[13px] text-frost-300">
                <dt className="flex items-center gap-2.5">
                  <SearchIcon className="text-frost-500" />
                  Buscar uma página
                </dt>
                <dd className="justify-self-end">
                  <Kbd>Ctrl P</Kbd>
                </dd>
                <dt className="flex items-center gap-2.5">
                  <NewPageIcon className="text-frost-500" />
                  Criar uma página
                </dt>
                <dd className="justify-self-end">
                  <Kbd>Ctrl N</Kbd>
                </dd>
                <dt className="flex items-center gap-2.5">
                  <GraphIcon className="text-frost-500" />
                  Abrir o grafo
                </dt>
                <dd className="justify-self-end">
                  <Kbd>Ctrl G</Kbd>
                </dd>
              </dl>
            </div>
          )}
        </Stage>
      </main>

      <Presence when={isNote} name="links">
        <LinksPanel backlinks={backlinks} outgoing={outgoing} onOpen={(path) => open(path)} onOpenTarget={openTarget} />
      </Presence>

      <Presence when={switcher} name="switcher">
        <QuickSwitcher
          notes={notes}
          onOpen={(path) => open(path)}
          onCreate={async (name) => open(await createNote(name))}
          onClose={() => setSwitcher(false)}
        />
      </Presence>
    </div>
  );
}
