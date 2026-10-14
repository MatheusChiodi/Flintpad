import { useEffect, useMemo, useRef, useState } from 'react';

import { baseName } from '../lib/links';
import { GRAPH, isSpecialPath, REQUESTS, type Note, type Tab } from '../types';
import { BacklinkIcon, CloseIcon, GraphIcon, Kbd, OutlinkIcon, PageIcon, PlusIcon, SearchIcon, RequestIcon } from './Icons';

const currentPath = (tab: Tab) => tab.stack[tab.idx] ?? '';

export function tabTitle(tab: Tab) {
  const path = currentPath(tab);
  if (path === GRAPH) return 'Grafo';
  if (path === REQUESTS) return 'Requests';
  return path ? baseName(path) : 'Nova guia';
}

type TabBarProps = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onNew: () => void;
};

export function TabBar({ tabs, activeId, onSelect, onClose, onNew }: TabBarProps) {
  return (
    <div className="flex h-11 shrink-0 items-end gap-1 pl-[18px] pr-3">
      {tabs.map((tab) => {
        const path = currentPath(tab);
        const TabIcon = path === GRAPH ? GraphIcon : path === REQUESTS ? RequestIcon : path ? PageIcon : PlusIcon;
        return (
          <div
            key={tab.id}
            className="tab group flex h-[34px] min-w-0 max-w-52 flex-1 cursor-pointer items-center gap-2 rounded-t-lg pl-3 pr-1.5 text-[13px]"
            data-active={tab.id === activeId}
            data-sheet={Boolean(path) && !isSpecialPath(path)}
            onClick={() => onSelect(tab.id)}
            onAuxClick={(event) => event.button === 1 && onClose(tab.id)}
          >
            <TabIcon size={14} className="row-icon" />
            <span className="flex-1 truncate">{tabTitle(tab)}</span>
            <button
              className="icon-button reveal"
              title="Fechar guia"
              aria-label={`Fechar guia ${tabTitle(tab)}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <CloseIcon size={13} />
            </button>
          </div>
        );
      })}
      <button className="icon-button mb-1.5 ml-1 h-6 w-6" title="Nova guia" aria-label="Nova guia" onClick={onNew}>
        <PlusIcon size={15} />
      </button>
    </div>
  );
}

type LinksPanelProps = {
  backlinks: Note[];
  outgoing: { target: string; path?: string }[];
  onOpen: (path: string) => void;
  onOpenTarget: (target: string) => void;
};

export function LinksPanel({ backlinks, outgoing, onOpen, onOpenTarget }: LinksPanelProps) {
  const heading = 'section-label flex items-center justify-between px-4 pb-2 pt-4';
  const row = 'row w-full px-2 text-left text-[13px]';
  const empty = 'px-4 pb-1 text-[13px] leading-relaxed text-frost-500';

  return (
    <aside className="pane hidden w-60 shrink-0 overflow-y-auto pb-4 lg:block">
      <div className={heading}>
        <span>Backlinks</span>
        <span className="tabular-nums">{backlinks.length}</span>
      </div>
      <div className="px-2">
        {backlinks.map((note) => (
          <button key={note.path} className={row} title={note.path} onClick={() => onOpen(note.path)}>
            <BacklinkIcon size={14} className="row-icon" />
            <span className="truncate">{note.name}</span>
          </button>
        ))}
      </div>
      {!backlinks.length && <p className={empty}>Nenhuma página aponta para esta.</p>}

      <div className={`${heading} mt-3 border-t border-(--hairline)`}>
        <span>Links nesta página</span>
        <span className="tabular-nums">{outgoing.length}</span>
      </div>
      <div className="px-2">
        {outgoing.map((link) => (
          <button
            key={link.target}
            className={`${row} ${link.path ? '' : 'italic text-frost-500'}`}
            title={link.path ?? 'Página ainda não existe: clique para criar'}
            onClick={() => onOpenTarget(link.target)}
          >
            {link.path ? (
              <OutlinkIcon size={14} className="row-icon" />
            ) : (
              <PlusIcon size={14} className="row-icon" />
            )}
            <span className="truncate">{link.target}</span>
          </button>
        ))}
      </div>
      {!outgoing.length && (
        <p className={empty}>
          Digite <Kbd>[</Kbd> para ligar a outra página.
        </p>
      )}
    </aside>
  );
}

type SwitcherProps = {
  notes: Note[];
  onOpen: (path: string) => void;
  onCreate: (name: string) => void;
  onClose: () => void;
};

export function QuickSwitcher({ notes, onOpen, onCreate, onClose }: SwitcherProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    return notes.filter((n) => n.path.toLowerCase().includes(wanted)).slice(0, 30);
  }, [notes, query]);

  useEffect(() => input.current?.focus(), []);

  const confirm = () => {
    const picked = results[index];
    if (picked) onOpen(picked.path);
    else if (query.trim()) onCreate(query.trim());
    onClose();
  };

  return (
    <div className="scrim fixed inset-0 z-50 flex items-start justify-center pt-24" onMouseDown={onClose}>
      <div
        className="palette w-[560px] max-w-[90vw] overflow-hidden rounded-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-(--hairline) px-4">
          <SearchIcon size={18} className="shrink-0 text-frost-500" />
          <input
            ref={input}
            className="w-full bg-transparent py-3.5 text-[15px] text-frost-100 caret-sheen-400 outline-none placeholder:text-frost-500"
            placeholder="Buscar ou criar página…"
            aria-label="Buscar ou criar página"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              else if (event.key === 'Enter') confirm();
              else if (event.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, results.length - 1));
              else if (event.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
              else return;
              event.preventDefault();
            }}
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {results.map((note, i) => (
            <div
              key={note.path}
              className="row cursor-pointer px-2.5 py-1 text-[13px]"
              data-active={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => {
                onOpen(note.path);
                onClose();
              }}
            >
              <PageIcon size={14} className="row-icon" />
              <span className="truncate">{note.name}</span>
              <span className="ml-auto truncate pl-4 font-mono text-[11px] text-frost-500">{note.path}</span>
            </div>
          ))}
          {!results.length && (
            <p className="flex items-center gap-2 px-2.5 py-2 text-[13px] text-frost-300">
              {query.trim() ? (
                <>
                  <Kbd>Enter</Kbd> cria a página “{query.trim()}”
                </>
              ) : (
                'Nenhuma página.'
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-(--hairline) px-4 py-2 text-[11px] text-frost-500">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navegar
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd> abrir
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd> fechar
          </span>
        </div>
      </div>
    </div>
  );
}
